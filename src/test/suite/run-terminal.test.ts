import { verifyRunTerminal } from "../run-terminal-fixture";

suite("Run in a real integrated terminal", () => {
  test("first and repeated Run use the selected environment's console script with literal arguments", async function () {
    this.timeout(90000);
    await verifyRunTerminal();
  });
});
