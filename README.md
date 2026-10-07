# Markdown2CourseBook

VS Code extension that transforms Markdown (`.md`) notes into structured, navigable HTML course books. Generated pages are designed for comfortable reading, with clear sections, pagination, and quick navigation.

Repository: <https://github.com/sambrista/markdown2coursebook>

## Features

### Admonitions

Admonition blocks are rendered as visually distinct callouts:

```md
!!! note
    This is an important note for the student.

!!! warning
    Review this point before the exam.

!!! info
    This block provides additional context.

!!! tip
    A practical tip to help the student.
```

Supported types: `note`, `tip`, `warning`, `caution`, `important`, `danger`, `info`, `success`, `question`, `failure`, `bug`, `example`, `quote`, `abstract`, `todo`, `attention`, `seealso`, `deprecated`, `security`, `exercise`, and `solution`.

### Section navigation and pagination

Generated HTML includes a sidebar or table of contents, direct links between sections, pagination by section, and previous/next controls.

### Code blocks

Code blocks include syntax highlighting, consistent spacing, optional file labels, and a copy button. To show a filename above a code block, place a bold code-formatted label immediately before it:

```md
**`script.js`**
```

```js
const message = "Hello";
console.log(message);
```

Local images referenced by the Markdown file are embedded in the generated HTML, so they remain available when the HTML is moved.

## Commands

### Transform the current Markdown file

- Use the book button in the Markdown editor title bar.
- Right-click a `.md` file and select `Markdown2CourseBook: Transform current Markdown file to HTML`.

### Transform a complete folder

Right-click a folder in the Explorer and select `Markdown2CourseBook: Transform all Markdown files in this folder`. The extension searches recursively for `.md` files and processes them.

After transformation, a notification includes an **Open file** action for viewing the generated HTML in a browser.

The output folder can be changed with the `markdown2coursebook.outputFolder` setting. It defaults to `out` and accepts a path relative to the workspace root or an absolute path.

## Development

1. Open this repository in VS Code.
2. Run `npm install` from the repository root.
3. Press `F5`, or start the extension from **Run and Debug**.
4. A new VS Code Extension Development Host window opens.
5. Open a Markdown file or right-click a folder and run a command.

### Package the extension

1. Run `npm install` from the repository root.
2. Run `npx @vscode/vsce package` from the repository root.
3. The `.vsix` package is created in the repository root. Its filename includes the extension version from `package.json`.

## License

This project is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE).

---

## Documentación en castellano

Esta extensión transforma archivos Markdown (`.md`) en páginas HTML listas para lectura, con un estilo más tranquilo y estructurado para apuntes de clase. La salida está pensada para que el contenido se lea de forma más cómoda, sin una página infinita y con navegación rápida entre secciones.

## ¿Qué hace la extensión?

### 1. Soporte de admonitions

La extensión interpreta bloques tipo admonition en Markdown para convertirlos en cajas con estilo visual y semántica clara. Esto permite resaltar avisos, notas o información relevante sin perder legibilidad.

Ejemplo de uso:

```md
!!! note
    Esta es una nota importante para el alumno.

!!! warning
    Atención: revisa este punto antes del examen.

!!! info
    Este bloque sirve para explicar un detalle adicional.

!!! tip
    Un consejo práctico para el alumno.
```

Se reconocen estos tipos: `note`, `tip`, `warning`, `caution`, `important`, `danger`, `info`, `success`, `question`, `failure`, `bug`, `example`, `quote`, `abstract`, `todo`, `attention`, `seealso`, `deprecated`, `security`, `exercise` y `solution`.

En el HTML generado, estos bloques se renderizan como tarjetas con un título y estilo diferenciados según el tipo.

### 2. Navegación por secciones y paginación

La salida HTML genera una estructura de lectura más amigable:

- Sidebar o índice lateral con los apartados principales.
- Navegación entre secciones con enlaces directos.
- Paginación por apartados, de forma que cada bloque importante se presenta como una unidad más manejable.
- Botones de avance/retroceso para moverse entre páginas de contenido.

Esto ayuda a reducir la sensación de “página infinita” y facilita que el alumno se centre en cada tema de forma más ordenada.

### 3. Formateo de bloques de código

Los bloques de código se convierten en una vista más clara y usable, con:

- Resaltado de sintaxis según el lenguaje.
- Margen y estilo uniforme para mantener la lectura cómoda.
- Etiqueta del nombre del archivo cuando se indica explícitamente.
- Botón de copia para reutilizar el código fácilmente.

El formato de código queda visualmente más profesional y mucho más legible en la versión HTML.

Las imágenes locales referenciadas desde el Markdown se incrustan en el HTML generado, por lo que siguen disponibles aunque se mueva el archivo HTML.

### 4. Nombre del archivo en los bloques de código

Puedes fijar el nombre del archivo que aparece sobre un bloque de código escribiendo un texto en negrita con formato de código justo antes del bloque:

```md
**`script.js`**
```

```js
const mensaje = "Hola";
console.log(mensaje);
```

Con esto, la extensión muestra el nombre del archivo encima del bloque correspondiente en la salida HTML.

## Funcionalidades de la extensión

1. **Transformar el archivo Markdown abierto**:
   - Botón en la barra de título del editor Markdown.
   - Opción en el menú contextual del editor (`Clic derecho > Markdown2CourseBook: Transformar apunte Markdown a HTML`).
   - Opción en el menú contextual del explorador de archivos sobre cualquier fichero `.md`.

2. **Transformar carpetas completas**:
   - `Clic derecho en cualquier carpeta del Explorador > Markdown2CourseBook: Transformar todos los Markdown de esta carpeta`.
   - Busca y procesa recursivamente todos los `.md` dentro de la carpeta.

3. **Notificación y apertura rápida**:
   - Muestra una notificación con el resultado y un botón **"Abrir archivo"** para visualizar el HTML en el navegador.

4. **Configurar carpeta de salida**:
    - Cambia `markdown2coursebook.outputFolder` en la configuración de VS Code. Por defecto, los HTML se generan en `out`; también se admiten rutas absolutas.

## Cómo probarla en modo desarrollo

1. Abre este repositorio en VS Code.
2. Abre la carpeta `extensions/markdown2coursebook-vscode` o mantén el workspace abierto.
3. Presiona `F5` (o entra en la pestaña **Ejecutar y depurar** y lanza la extensión).
4. Se abrirá una nueva ventana de VS Code (*Extension Development Host*).
5. Abre cualquier archivo `teoria.md` o haz clic derecho en una carpeta (por ejemplo `UT 1`) y ejecuta el comando.

### Generar el paquete VSIX

1. Ejecuta `npm install` desde la raíz del repositorio.
2. Ejecuta `npx @vscode/vsce package` desde la raíz del repositorio.
3. El archivo `.vsix` se genera en la raíz. Su nombre incluye la versión de la extensión indicada en `package.json`.

## Licencia

Este proyecto se distribuye bajo la Licencia Pública General GNU v3.0. Consulta [LICENSE](LICENSE).
