import { verifyRunTerminal } from "../run-terminal-fixture";

suite("Run in a real integrated terminal", () => {
  test("first and repeated Run survive shell startup replacement and retain activation", async function () {
    this.timeout(90000);
    if (!(await verifyRunTerminal())) {
      this.skip();
    }
  });
  test("smart-quote task paths remain literal in PowerShell", async function () {
    this.timeout(90000);
    if (!(await verifyRunTerminal("powershell"))) {
      this.skip();
    }
  });
});
