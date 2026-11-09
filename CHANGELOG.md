# Changelog

Todos los cambios relevantes de este proyecto se documentan en este archivo.

## [1.1.6]

### Añadido
- Botón en la cabecera para alternar entre tema claro y oscuro. La elección se recuerda en el navegador; mientras no se elija, se sigue el tema del sistema (también si cambia con la página abierta).

## [1.1.5]

### Corregido
- Los saltos a apartados desde el índice o desde enlaces internos terminan en la posición correcta aunque el índice se pliegue o la cabecera se compacte durante el desplazamiento.
- El contenido ya no se desplaza al compactarse la cabecera fija.

## [1.1.4]

### Cambiado
- Cabecera compacta: título y botones de paginación en una sola línea, con la misma altura que el índice plegado.
- La barra de progreso superior solo aparece cuando la cabecera completa deja de verse.

## [1.1.3]

### Añadido
- Cabecera fija en pantallas grandes con el título, la barra de progreso y la paginación.

### Cambiado
- Encabezados de mayor tamaño.

## [1.1.2]

### Añadido
- Las imágenes que ocupan un párrafo por sí solas se muestran centradas.

## [1.1.1]

### Añadido
- Buscador en el índice (atajo `/`), sin distinguir tildes y con resaltado de coincidencias.
- Apartados del índice desplegables.
- Índice como panel deslizante en pantallas estrechas, con botón flotante para abrirlo.
- Barra de progreso de lectura (secciones completadas más lo leído de la actual).
- Aviso para continuar la lectura donde se dejó.
- Cada sección tiene su propia URL e integra el historial del navegador (atrás/adelante) y los enlaces internos del contenido.
- Tema oscuro automático según la configuración del sistema.
- Estilos de impresión: todas las páginas seguidas y sin elementos de navegación.

## [1.0.5]

### Añadido
- Icono de la extensión (`images/icon.png`).

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
