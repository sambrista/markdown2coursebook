# Changelog

Todos los cambios relevantes de este proyecto se documentan en este archivo.

## [1.0.4]

### Corregido
- Con anchos de ventana de unos 940 px (menos de 980 px), al hacer scroll y contraerse el panel de navegación, el contenido principal se quedaba en unos 54 px de ancho.

## [1.0.3]

### Añadido
- Admonitions anidados o con sangría (dentro de listas, por ejemplo), respetando la indentación original.

## [1.0.2]

### Añadido
- Soporte y estilos para todos los tipos de admonition: `note`, `tip`, `warning`, `caution`, `important`, `danger`, `info`, `success`, `question`, `failure`, `bug`, `example`, `quote`, `abstract`, `todo`, `seealso`, `deprecated`, `security`, `exercise`, entre otros.

### Documentación
- README actualizados con ejemplos y tipos de admonition soportados.

## [1.0.1]

### Añadido
- Instrucciones para generar el paquete `.vsix` en el README.

### Corregido
- Las imágenes locales se incrustan correctamente en el HTML generado (base64), y las imágenes dentro de admonitions se ajustan al ancho disponible.

## [1.0.0]

### Añadido
- Ajuste `markdown2coursebook.outputFolder` para elegir la carpeta de salida (por defecto `out`), relativa al workspace o absoluta.
- Eliminación de comentarios HTML del contenido generado.
- Incrustación de imágenes locales en el HTML.
- Mejor comportamiento del panel de navegación: al ocultarlo o mostrarlo manualmente no se contrae automáticamente por el scroll.
- El título de cada página se obtiene del encabezado de nivel 1 del Markdown.

### Versión inicial
- Extensión de VS Code que transforma archivos Markdown (`teoria.md`) y carpetas en páginas HTML de apuntes con índice lateral, paginación, barra de progreso, admonitions y resaltado de sintaxis.
