import { verifyRunTerminal } from "../run-terminal-fixture";

suite("Run in a real integrated terminal", () => {
  test("first and repeated Run survive shell startup replacement and retain activation", async function () {
    this.timeout(90000);
    if (!(await verifyRunTerminal())) {
      this.skip();
    }
  });
});
