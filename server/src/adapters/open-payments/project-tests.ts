// The server tsconfig only includes src/. These imports put the Open Payments
// test doubles and contract suites in that program so eslint can type-check them.
import '../../../test/contracts/grant-gateway.contract.ts'
import '../../../test/contracts/grant-gateway.test.ts'
import '../../../test/contracts/payments-network.contract.ts'
import '../../../test/contracts/payments-network.test.ts'
import '../../../test/fakes/fake-grant-gateway.ts'
import '../../../test/fakes/fake-payments-network.ts'
