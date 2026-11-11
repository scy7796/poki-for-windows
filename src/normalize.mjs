import * as acorn from 'acorn';

function stripCodeFences(code) {
  const fenced = /^```(?:js|javascript|typescript|ts|tsx|jsx)?\s*\n([\s\S]*?)```\s*$/;
  const match = code.match(fenced);
  return match ? match[1] : code;
}

// Models send a function body, an async arrow function, a named function or fenced code.
// Every form becomes one async arrow function source, so the sandbox only ever calls it.
export function normalizeCode(code) {
  const trimmed = stripCodeFences(code.trim());
  if (!trimmed.trim()) return 'async () => {}';
  const source = trimmed.trim();
  let ast;
  try { ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }); }
  catch { return `async () => {\n${source}\n}`; }
  const [first] = ast.body, last = ast.body.at(-1);
  if (ast.body.length === 1 && first.type === 'ExpressionStatement' && first.expression.type === 'ArrowFunctionExpression') return source;
  if (ast.body.length === 1 && first.type === 'ExportDefaultDeclaration') {
    const declaration = first.declaration, inner = source.slice(declaration.start, declaration.end);
    if (declaration.type === 'FunctionDeclaration' && !declaration.id) return `async () => {\nreturn (${inner})();\n}`;
    if (declaration.type === 'ClassDeclaration' && !declaration.id) return `async () => {\nreturn (${inner});\n}`;
    return normalizeCode(inner);
  }
  if (ast.body.length === 1 && first.type === 'FunctionDeclaration') return `async () => {\n${source}\nreturn ${first.id?.name ?? 'fn'}();\n}`;
  if (last?.type === 'ExpressionStatement') return `async () => {\n${source.slice(0, last.start)}return (${source.slice(last.expression.start, last.expression.end)})\n}`;
  return `async () => {\n${source}\n}`;
}
