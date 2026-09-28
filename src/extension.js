import path from "node:path";
import * as vscode from "vscode";

const transformerModule = await loadTransformerModule();
const { transformFile } = transformerModule;

async function loadTransformerModule() {
  const candidatePaths = [
    new URL("../tools/src/transform-notes.mjs", import.meta.url),
    new URL("../tools/notes-transformer/src/transform-notes.mjs", import.meta.url),
    new URL("../../tools/notes-transformer/src/transform-notes.mjs", import.meta.url)
  ];

  let lastError;
  for (const candidate of candidatePaths) {
    try {
      return await import(candidate.href);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("No se encontró el transformador Markdown.");
}

/**
 * Encuentra la raíz del espacio de trabajo adecuada para un archivo dado.
 */
function getWorkspaceRootDir(fileUri) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
  if (workspaceFolder) {
    return workspaceFolder.uri.fsPath;
  }
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    return vscode.workspace.workspaceFolders[0].uri.fsPath;
  }
  return path.dirname(fileUri.fsPath);
}

function getOutputDir(rootDir) {
  const outputFolder = vscode.workspace.getConfiguration("markdown2coursebook").get("outputFolder", "out");
  return path.resolve(rootDir, outputFolder);
}

/**
 * Transforma un único archivo Markdown.
 */
async function transformSingleFile(targetUri) {
  if (!targetUri) {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.languageId === "markdown") {
      targetUri = editor.document.uri;
    }
  }

  if (!targetUri) {
    vscode.window.showWarningMessage("No hay ningún archivo Markdown abierto ni seleccionado.");
    return;
  }

  const filePath = targetUri.fsPath;
  if (!filePath.toLowerCase().endsWith(".md")) {
    vscode.window.showWarningMessage("El archivo seleccionado no es un archivo Markdown (.md).");
    return;
  }

  const rootDir = getWorkspaceRootDir(targetUri);
  const outDir = getOutputDir(rootDir);

  try {
    const outputPath = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Transformando ${path.basename(filePath)}...`,
        cancellable: false
      },
      async () => {
        return await transformFile(filePath, outDir, rootDir);
      }
    );

    const openAction = "Abrir archivo";
    const selected = await vscode.window.showInformationMessage(
      `Apunte transformado con éxito: ${path.relative(rootDir, outputPath)}`,
      openAction
    );

    if (selected === openAction) {
      const outputUri = vscode.Uri.file(outputPath);
      await vscode.env.openExternal(outputUri);
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Error al transformar ${path.basename(filePath)}: ${error.message}`);
  }
}

/**
 * Transforma recursivamente todos los archivos .md dentro de una carpeta seleccionada.
 */
async function transformFolder(folderUri) {
  if (!folderUri) {
    vscode.window.showWarningMessage("No se ha seleccionado ninguna carpeta.");
    return;
  }

  const folderPath = folderUri.fsPath;
  const rootDir = getWorkspaceRootDir(folderUri);
  const outDir = getOutputDir(rootDir);

  try {
    const pattern = new vscode.RelativePattern(folderUri, "**/*.md");
    const mdFiles = await vscode.workspace.findFiles(pattern);

    if (mdFiles.length === 0) {
      vscode.window.showInformationMessage(`No se encontraron archivos .md en la carpeta: ${path.basename(folderPath)}`);
      return;
    }

    const generatedOutputs = [];

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Transformando ${mdFiles.length} archivo(s) .md...`,
        cancellable: false
      },
      async (progress) => {
        const increment = 100 / mdFiles.length;
        for (const file of mdFiles) {
          const outFile = await transformFile(file.fsPath, outDir, rootDir);
          generatedOutputs.push(outFile);
          progress.report({ increment, message: path.basename(file.fsPath) });
        }
      }
    );

    const openFirstAction = "Abrir primero";
    const message = `Se han transformado con éxito ${generatedOutputs.length} archivo(s) en la carpeta "${path.relative(rootDir, outDir)}".`;
    const selected = await vscode.window.showInformationMessage(message, openFirstAction);

    if (selected === openFirstAction && generatedOutputs.length > 0) {
      await vscode.env.openExternal(vscode.Uri.file(generatedOutputs[0]));
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Error al transformar la carpeta: ${error.message}`);
  }
}

/**
 * @param {vscode.ExtensionContext} context
 */
export function activate(context) {
  const currentFileCmd = vscode.commands.registerCommand(
    "notesTransformer.transformCurrentFile",
    (uri) => transformSingleFile(uri)
  );

  const folderCmd = vscode.commands.registerCommand(
    "notesTransformer.transformFolder",
    (uri) => transformFolder(uri)
  );

  context.subscriptions.push(currentFileCmd, folderCmd);
}

export function deactivate() {}
