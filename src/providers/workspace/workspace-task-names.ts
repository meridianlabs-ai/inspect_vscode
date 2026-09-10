// Keep workspace discovery's lightweight syntax: @task, optional arguments
// through the first ')', then a function on the next line. These patterns are
// anchored at line starts or at an explicit cursor; neither searches a suffix
// from every opening parenthesis.
export function workspaceTaskNames(text: string): string[] {
  const decorator = /^[ \t]*@task/gm;
  const functionAfter = /[ \t]*\r?\n[ \t]*def\s+([A-Za-z_]\w*)\s*\(/y;
  const names: string[] = [];
  let closingParen = -1;
  let failedClosingParen = -1;

  while (decorator.exec(text)) {
    let functionStart = decorator.lastIndex;
    const hasArguments = text[functionStart] === "(";
    if (hasArguments) {
      // Candidates before the same ')' share its lookup, including the case
      // where no ')' remains. The searched intervals never overlap.
      if (closingParen < functionStart) {
        const next = text.indexOf(")", functionStart + 1);
        closingParen = next === -1 ? text.length : next;
      }
      if (closingParen === text.length) {
        continue;
      }
      functionStart = closingParen + 1;
    }

    // Repeated unclosed decorators can also share a closing ')' whose suffix
    // is not a function. Test that suffix only once.
    if (hasArguments && closingParen === failedClosingParen) {
      continue;
    }
    functionAfter.lastIndex = functionStart;
    const match = functionAfter.exec(text);
    if (match?.[1]) {
      names.push(match[1]);
      decorator.lastIndex = functionAfter.lastIndex;
    } else if (hasArguments) {
      failedClosingParen = closingParen;
    }
  }
  return names;
}
