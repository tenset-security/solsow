import { Command } from "@commander-js/extra-typings"
import { glob } from "glob"
import invariant from "tiny-invariant"
import parser from "@solidity-parser/parser"
import type {
  ContractDefinition,
  FunctionDefinition,
} from "@solidity-parser/parser/dist/src/ast-types.d.ts"
import path from "node:path"
import * as changeCase from "change-case"
import fs from "fs-extra"

type ParseResult = ReturnType<typeof parser.parse>

type Testable = {
  path: string
  value: string
  ast: ParseResult
  contractNode: ContractDefinition
  functionNode: FunctionDefinition
  testsPath: string
}

function getAst<T extends Pick<Testable, "value">>(
  testable: T
): T & Pick<Testable, "ast"> {
  return {
    ...testable,
    ast: parser.parse(testable.value), // TODO handle parsing errors
  }
}

function attachContractNode<T extends Pick<Testable, "ast">>(
  acc: (T & Pick<Testable, "contractNode">)[],
  testable: T
): (T & Pick<Testable, "contractNode">)[] {
  const contractNodes: ContractDefinition[] = []
  parser.visit(testable.ast, {
    ContractDefinition: (node) => contractNodes.push(node),
  })
  return [
    ...acc,
    ...contractNodes.map((contractNode) => ({
      ...testable,
      contractNode,
    })),
  ]
}

function onlyTestableContracts({
  contractNode,
}: Pick<Testable, "contractNode">) {
  return ["contract", "library", "abstract"].includes(contractNode.kind)
}

function attachFunctionNode<T extends Pick<Testable, "contractNode">>(
  acc: (T & Pick<Testable, "functionNode">)[],
  testable: T
) {
  const functionNodes: FunctionDefinition[] = []
  parser.visit(testable.contractNode, {
    FunctionDefinition: (node) => functionNodes.push(node),
  })
  return [
    ...acc,
    ...functionNodes.map((functionNode) => ({
      ...testable,
      functionNode,
    })),
  ]
}

function onlyTestableFunctions({
  contractNode,
  functionNode,
}: Pick<Testable, "contractNode" | "functionNode">) {
  if (contractNode.kind === "library") return true
  return ["default", "external", "public"].includes(functionNode.visibility)
}

function getContractName(contractNode: ContractDefinition): string {
  return contractNode.name
}
function getFunctionName(functionNode: FunctionDefinition): string {
  if (functionNode.isConstructor) return "constructor"
  if (functionNode.isFallback) return "fallback"
  if (functionNode.isReceiveEther) return "receive"
  invariant(functionNode.name)
  return functionNode.name
}

function getTestPath<
  T extends Pick<Testable, "path" | "contractNode" | "functionNode" | "ast">
>(testable: T): string {
  const contractName = getContractName(testable.contractNode)
  const functionName = getFunctionName(testable.functionNode)
  const testableContractsCount = attachContractNode([], testable).length
  return path.join(
    "test",
    "concrete",
    path.dirname(testable.path).split(path.sep).slice(1).join(path.delimiter),
    changeCase.kebabCase(
      path.basename(testable.path).replace(path.extname(testable.path), "")
    ),
    testableContractsCount > 1 ? changeCase.kebabCase(contractName) : "",
    changeCase.kebabCase(functionName)
  )
}

function attachTestPath<
  T extends Pick<Testable, "path" | "contractNode" | "functionNode" | "ast">
>(testable: T): T & { testPath: string } {
  return { ...testable, testPath: getTestPath(testable) }
}

export default new Command()
  .command("outline")
  .addHelpText(
    "beforeAll",
    "Generates test files based on your solidity code\n"
  )
  .alias("o")
  .action(async () => {
    const [solPaths, outlinePaths] = await Promise.all(
      ["src/**/*.sol", "test/concrete/**/*.outline"].map((pattern) =>
        glob(pattern)
      )
    )
    invariant(solPaths)
    invariant(outlinePaths)
    const solFiles: Pick<Testable, "path" | "value">[] = await Promise.all(
      solPaths?.map(async (path) => ({
        path,
        value: await fs.readFile(path, "utf-8"),
      }))
    )

    const testables = solFiles
      .map(getAst)
      .reduce<Pick<Testable, "contractNode" | "ast" | "path" | "value">[]>(
        attachContractNode,
        []
      )
      .filter(onlyTestableContracts)
      .reduce<
        Pick<
          Testable,
          "contractNode" | "ast" | "value" | "path" | "functionNode"
        >[]
      >(attachFunctionNode, [])
      .filter(onlyTestableFunctions)
      .map(attachTestPath)

    await Promise.all(
      testables.map((testable) => fs.ensureDir(testable.testPath))
    )
  })
