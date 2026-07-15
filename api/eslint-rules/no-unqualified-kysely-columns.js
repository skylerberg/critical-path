const JOIN_METHODS = new Set(["innerJoin", "leftJoin", "rightJoin", "fullJoin"]);

const ARRAY_COLUMN_METHODS = new Set([
  "select",
  "returning",
  "groupBy",
  "distinctOn",
]);

const SCALAR_COLUMN_METHODS = new Set([
  "where",
  "whereRef",
  "orderBy",
]);

function isQualifiedColumn(value) {
  if (typeof value !== "string") return true;
  return value.includes(".");
}

function chainHasJoin(node) {
  let cur = node;
  while (cur) {
    if (cur.type === "CallExpression") {
      const callee = cur.callee;
      if (
        callee &&
        callee.type === "MemberExpression" &&
        callee.property &&
        callee.property.type === "Identifier"
      ) {
        if (JOIN_METHODS.has(callee.property.name)) return true;
        cur = callee.object;
        continue;
      }
      return false;
    }
    if (cur.type === "MemberExpression") {
      cur = cur.object;
      continue;
    }
    return false;
  }
  return false;
}

function unwrapArrayLike(node) {
  if (!node) return null;
  if (node.type === "ArrayExpression") return node;
  if (node.type === "ArrowFunctionExpression") {
    if (node.body.type === "ArrayExpression") return node.body;
    if (node.body.type === "BlockStatement") {
      for (const stmt of node.body.body) {
        if (
          stmt.type === "ReturnStatement" &&
          stmt.argument &&
          stmt.argument.type === "ArrayExpression"
        ) {
          return stmt.argument;
        }
      }
    }
  }
  return null;
}

function reportLiteral(context, node) {
  if (
    node &&
    node.type === "Literal" &&
    typeof node.value === "string" &&
    !isQualifiedColumn(node.value)
  ) {
    context.report({
      node,
      messageId: "unqualified",
      data: { column: node.value },
    });
  }
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require fully-qualified column names (table.column) in Kysely queries that join multiple tables, to prevent runtime 'column reference is ambiguous' SQL errors when joined tables share a column name.",
    },
    schema: [],
    messages: {
      unqualified:
        'Unqualified column "{{column}}" in a Kysely query that joins multiple tables. Use "table.{{column}}" so a future shared column name on either side does not produce an ambiguous-column SQL error.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          !callee ||
          callee.type !== "MemberExpression" ||
          !callee.property ||
          callee.property.type !== "Identifier"
        ) {
          return;
        }
        const methodName = callee.property.name;
        const isArrayMethod = ARRAY_COLUMN_METHODS.has(methodName);
        const isScalarMethod = SCALAR_COLUMN_METHODS.has(methodName);
        if (!isArrayMethod && !isScalarMethod) return;

        if (!chainHasJoin(callee.object)) return;

        const firstArg = node.arguments[0];
        if (!firstArg) return;

        if (isArrayMethod) {
          const arr = unwrapArrayLike(firstArg);
          if (arr) {
            for (const el of arr.elements) {
              reportLiteral(context, el);
            }
          } else {
            reportLiteral(context, firstArg);
          }
          return;
        }

        reportLiteral(context, firstArg);
        if (methodName === "whereRef" && node.arguments[2]) {
          reportLiteral(context, node.arguments[2]);
        }
      },
    };
  },
};

export default rule;
