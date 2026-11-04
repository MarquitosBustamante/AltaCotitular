# Lectura local de PDF e imágenes

`import.js` lee campos editables del formulario Balanz, texto por ubicación en PDFs aplanados y texto mediante OCR en imágenes y PDFs escaneados. Usa las posiciones de `LAYOUT` y la plantilla incorporada al HTML para separar las etiquetas impresas de los valores. Los archivos se procesan en el navegador; no se suben a APIs. No requiere claves ni funciones de Netlify.

La revisión permite corregir y seleccionar los datos antes de incorporarlos. Las diferencias entre páginas/archivos, los cambios sobre datos existentes y las lecturas de baja confianza quedan sin seleccionar. Los campos vacíos o valores predeterminados de la plantilla no se interpretan como respuestas del cliente. No se deducen declaraciones fiscales ni se copian firmas. El generador existente imprime los datos en las páginas correspondientes, incluidas 1 y 20.

Para imágenes y PDFs de una sola página, seleccionar el número de página del formulario original. Las imágenes deben mostrar la hoja completa, derecha, sin márgenes ajenos al papel. OCR está pensado para texto escrito en computadora y puede confundir caracteres: revisar especialmente DNI, fechas, importes y correo. Una imagen recortada, borrosa o de otra versión del formulario puede no reconocerse. Los PDFs con contraseña requieren una copia desbloqueada.

## Recursos incluidos

Copiados de paquetes npm oficiales, con versiones fijas:

- `pdfjs-dist` 6.5.438: PDF.js, worker y renderer; Apache-2.0 (`PDFJS-LICENSE`).
- `tesseract.js` 7.0.0: biblioteca y worker; Apache-2.0 (`TESSERACT-LICENSE` y avisos `*.LICENSE.txt`).
- `tesseract.js-core` 6.1.2: variantes WebAssembly con/sin SIMD; Apache-2.0 (`CORE-LICENSE`).
- `@tesseract.js-data/spa` 1.0.0: modelo español `4.0.0/spa.traineddata.gz`; Apache-2.0.

Estos archivos se sirven desde el mismo sitio, sin CDN externo. Debe publicarse la carpeta `assets/import` junto con el HTML. El lector carga sus recursos al usarlo por primera vez; requiere acceso al sitio. El flujo de pegar texto y generar PDF conserva sus bibliotecas incorporadas.

## Validación

Con Python, Playwright y Chromium instalados, iniciar desde la raíz del repositorio:

```sh
python3 -m http.server 8001 --bind 127.0.0.1
```

En otra terminal:

```sh
python3 tests/import_smoke.py
```

Se puede ajustar `BALANZ_TEST_URL` y `CHROMIUM_PATH`. Las pruebas generan documentos sintéticos en una carpeta temporal: campos de PDF, PDF aplanado, OCR de imagen/escaneo, revisión, conservación de datos existentes, archivos inválidos y cancelación. También verifican nombre y DNI en las páginas 1 y 20 del PDF generado. No usan datos de clientes.

La sección de cónyuge está siempre visible e incluye apellido, nombre, tipo y número de documento. Es opcional cuando no corresponde, y se exige completa si el estado civil es casado/a o se empieza a cargar alguno de sus datos. El tipo de documento se recupera del PDF o de una etiqueta explícita en el mail; no se supone DNI por tener un número. La generación conserva estos datos en las páginas 1 y 20 aunque todavía falte indicar el estado civil.

Regresión específica del cónyuge:

```sh
python3 tests/spouse_smoke.py
```

## PDF con datos pendientes

En «Formulario completo», los datos ya cargados se imprimen y sus casillas se retiran. Las casillas originales sin datos se conservan como campos editables (texto, listas y grupos de opciones sin contestar), incluso las del cónyuge. Si un nombre de campo se reutiliza en distintos lugares, solo se retiran sus casillas ya impresas. Los campos internos de ID de apertura se siguen excluyendo. No se mantienen respuestas predeterminadas de la plantilla como si fueran datos aportados.

La prueba `python3 tests/fillable_smoke.py` genera un PDF parcial, completa campos pendientes, guarda el archivo y verifica los valores al volver a abrirlo; también prueba el botón de descarga y la conservación del modo cliente.
