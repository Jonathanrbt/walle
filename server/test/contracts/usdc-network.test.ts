import {
  Account,
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'
import { readEnvelope } from '../../src/adapters/stellar/envelope.ts'
import { HorizonUsdcNetwork } from '../../src/adapters/stellar/usdc-network.ts'
import { money } from '../../src/shared/money.ts'
import { loadConfig } from '../../src/config.ts'
import { StellarError } from '../../src/treasury/usdc-network.ts'
import { FakeUsdcNetwork } from '../fakes/fake-usdc-network.ts'
import {
  PAYMENT_FLOOR,
  REFILL_TARGET,
  runUsdcNetworkContract,
  type UsdcNetworkFixture,
} from './usdc-network.contract.ts'

runUsdcNetworkContract('fake usdc network', async () => {
  const fake = new FakeUsdcNetwork()
  await fake.ensureOperatorReady()
  fake.creditOperator(money(10_000n, 'USDC', 2))
  return {
    network: fake,
    usdcIssuer: fake.usdcIssuer,
    funding: 'ready',
    fundingDetail: 'in-memory operator credited',
    createAccount: () => fake.createAccount(),
    addUsdcTrustline: (secret) => fake.addUsdcTrustline(secret),
    loseNextSubmitResponse: () => {
      fake.loseNextSubmitResponse()
    },
    armApplyBetweenDeadReads: () => {
      fake.armApplyBetweenDeadReads()
    },
  }
})

describe('fake usdc network failure injection', () => {
  it('does not apply a timeout, and a bad sequence does not move USDC', async () => {
    const fake = await fundedFake()
    const dest = await readyDestination(fake)
    const before = await fake.balance()
    const prepared = await fake.prepareTransfer({
      to: dest,
      amount: money(1n, 'USDC', 2),
      memo: 't',
    })
    fake.failNextSubmitWith('timeout')
    expect(await fake.submit(prepared)).toEqual({ kind: 'unknown' })
    expect(await fake.lookup(prepared.txHash)).toEqual({ kind: 'not_found' })
    expect((await fake.balance()).amount).toBe(before.amount)

    fake.failNextSubmitWith('bad_seq')
    expect(await fake.submit(prepared)).toEqual({ kind: 'rejected', code: 'tx_bad_seq' })
    expect((await fake.balance()).amount).toBe(before.amount)
  })

  it('recovers a tx_bad_seq when the hash was applied but the first lookup missed it', async () => {
    const fake = await fundedFake()
    const dest = await readyDestination(fake)
    const prepared = await fake.prepareTransfer({
      to: dest,
      amount: money(1n, 'USDC', 2),
      memo: 'hide',
    })
    const first = await fake.submit(prepared)
    expect(first.kind).toBe('success')
    const balance = (await fake.balance()).amount
    fake.hideNextLookup()
    const second = await fake.submit(prepared)
    expect(second).toEqual(first)
    expect((await fake.balance()).amount).toBe(balance)
  })

  it('records an underfunded injection as a failed ledger transaction', async () => {
    const fake = await fundedFake()
    const dest = await readyDestination(fake)
    const before = await fake.balance()
    const prepared = await fake.prepareTransfer({
      to: dest,
      amount: money(1n, 'USDC', 2),
      memo: 'poor',
    })
    fake.failNextSubmitWith('underfunded')
    expect(await fake.submit(prepared)).toEqual({ kind: 'rejected', code: 'op_underfunded' })
    expect(await fake.lookup(prepared.txHash)).toEqual({ kind: 'failed', code: 'op_underfunded' })
    expect((await fake.balance()).amount).toBe(before.amount)
    expect(await fake.isEnvelopeDead(prepared)).toMatchObject({ dead: false })
  })

  it('reports no_trustline when the destination limit is already full', async () => {
    const fake = new FakeUsdcNetwork()
    await fake.ensureOperatorReady()
    const account = await fake.createAccount()
    const full = money(10_000_000n, 'USDC', 7)
    await fake.addUsdcTrustline(account.secret, { limit: full, balance: full })
    expect(await fake.validateDestination(account.address)).toEqual({
      ok: false,
      reason: 'no_trustline',
    })
  })

  it('throws operator_not_ready when the operator account does not exist', async () => {
    const fake = new FakeUsdcNetwork()
    fake.removeOperator()
    await expect(fake.ensureOperatorReady()).rejects.toMatchObject({ kind: 'operator_not_ready' })
    await expect(fake.balance()).rejects.toMatchObject({ kind: 'operator_not_ready' })
  })

  it('refills XLM into USDC up to the target and throws no_path when XLM cannot pay', async () => {
    const fake = new FakeUsdcNetwork()
    await fake.ensureOperatorReady()
    const bought = await fake.refill({ targetUsdc: money(200n, 'USDC', 2) })
    expect(bought.usdc).toEqual(money(2_000_0000n, 'USDC', 7))
    expect((await fake.lookup(bought.txHash)).kind).toBe('success')
    expect(await fake.balance()).toEqual(money(2_000_0000n, 'USDC', 7))
    await expect(fake.refill({ targetUsdc: money(200n, 'USDC', 2) })).rejects.toMatchObject({
      kind: 'invalid',
    })

    fake.setOperatorXlm(money(1_500_0000n, 'XLM', 7))
    fake.setOperatorUsdc(money(0n, 'USDC', 7))
    await expect(fake.refill({ targetUsdc: money(100n, 'USDC', 2) })).rejects.toBeInstanceOf(
      StellarError,
    )
    await expect(fake.refill({ targetUsdc: money(100n, 'USDC', 2) })).rejects.toMatchObject({
      kind: 'no_path',
    })
  })

  it('kills a prepared envelope when refill advances the sequence', async () => {
    const fake = new FakeUsdcNetwork()
    await fake.ensureOperatorReady()
    const dest = await readyDestination(fake)
    const prepared = await fake.prepareTransfer({
      to: dest,
      amount: money(1n, 'USDC', 7),
      memo: 'stale',
    })
    await fake.refill({ targetUsdc: money(100n, 'USDC', 2) })
    expect(await fake.lookup(prepared.txHash)).toEqual({ kind: 'not_found' })
    expect(await fake.isEnvelopeDead(prepared)).toMatchObject({ dead: true })
  })

  it('waits out the ingest margin before an unsent envelope expires', async () => {
    const fake = new FakeUsdcNetwork()
    await fake.ensureOperatorReady()
    const dest = await readyDestination(fake)
    const prepared = await fake.prepareTransfer({
      to: dest,
      amount: money(1n, 'USDC', 7),
      memo: 'expiry',
    })
    const maxTime = readEnvelope(prepared.envelopeXdr).maxTime
    fake.useNow(() => new Date(Number(maxTime) * 1000))
    expect(await fake.isEnvelopeDead(prepared)).toMatchObject({ dead: false })
    fake.useNow(() => new Date(Number(maxTime + 29n) * 1000))
    expect(await fake.isEnvelopeDead(prepared)).toMatchObject({ dead: false })
    fake.useNow(() => new Date(Number(maxTime + 30n) * 1000))
    expect(await fake.isEnvelopeDead(prepared)).toMatchObject({ dead: true })
  })
})

describe.skipIf(process.env.TESTNET !== '1')('horizon usdc network', () => {
  runUsdcNetworkContract('testnet usdc network', async () => {
    const config = loadConfig(process.env)
    const network = new HorizonUsdcNetwork({
      horizonUrl: config.stellar.horizonUrl,
      usdcIssuer: config.stellar.usdcIssuer,
      operatorSecret: config.stellar.operatorSecret,
    })
    await network.ensureOperatorReady()
    const funding = await fundOperator(network)
    // One summary line. No secrets, no envelopes, no env values.
    console.info(`usdc-network testnet: ${funding.fundingDetail}`)
    return {
      network,
      usdcIssuer: config.stellar.usdcIssuer,
      funding: funding.funding,
      fundingDetail: funding.fundingDetail,
      createAccount: friendbotAccount,
      addUsdcTrustline: (secret) =>
        openUsdcTrustline(config.stellar.horizonUrl, config.stellar.usdcIssuer, secret),
    }
  })
})

async function fundedFake(): Promise<FakeUsdcNetwork> {
  const fake = new FakeUsdcNetwork()
  await fake.ensureOperatorReady()
  fake.creditOperator(money(10_000n, 'USDC', 2))
  return fake
}

async function readyDestination(fake: FakeUsdcNetwork): Promise<string> {
  const created = await fake.createAccount()
  await fake.addUsdcTrustline(created.secret)
  return created.address
}

async function fundOperator(
  network: HorizonUsdcNetwork,
): Promise<Pick<UsdcNetworkFixture, 'funding' | 'fundingDetail'>> {
  const before = await network.balance()
  if (before.amount >= 20_000_000n) {
    return {
      funding: 'ready',
      fundingDetail: 'operator USDC balance already covered the payment tests',
    }
  }
  try {
    await network.refill({ targetUsdc: REFILL_TARGET })
  } catch (error) {
    if (error instanceof StellarError && error.kind === 'no_path') {
      return {
        funding: 'blocked',
        fundingDetail:
          'BLOCKED: operator USDC balance is below 2 and refill found no XLM to USDC path',
      }
    }
    throw error
  }
  const after = await network.balance()
  if (after.amount < PAYMENT_FLOOR.amount * 100_000n) {
    return {
      funding: 'blocked',
      fundingDetail: 'BLOCKED: refill returned but the operator USDC balance is still below 2',
    }
  }
  return {
    funding: 'ready',
    fundingDetail: 'refill succeeded; payment tests use the operator USDC balance',
  }
}

async function friendbotAccount(): Promise<{ address: string; secret: string }> {
  const keypair = Keypair.random()
  const response = await fetch(
    `https://friendbot.stellar.org?addr=${encodeURIComponent(keypair.publicKey())}`,
  )
  if (!response.ok) {
    throw new Error(`friendbot responded ${String(response.status)}`)
  }
  return { address: keypair.publicKey(), secret: keypair.secret() }
}

async function openUsdcTrustline(
  horizonUrl: string,
  usdcIssuer: string,
  secret: string,
): Promise<void> {
  const keypair = Keypair.fromSecret(secret)
  const server = new Horizon.Server(horizonUrl)
  const account = await server.loadAccount(keypair.publicKey())
  const fee = await server.fetchBaseFee()
  const tx = new TransactionBuilder(new Account(account.accountId(), account.sequenceNumber()), {
    fee: String(fee),
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset: new Asset('USDC', usdcIssuer) }))
    .setTimeout(300)
    .build()
  tx.sign(keypair)
  await server.submitTransaction(tx, { skipMemoRequiredCheck: true })
}
