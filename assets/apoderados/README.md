# Apoderados

La pestaña Apoderados mantiene un estado independiente de las dos pestañas de cotitulares. Las plantillas originales son las suministradas por el usuario el 4 de noviembre de 2026: BCV de 3 páginas y BSGFCI de 3 páginas. `template.pdf` las une en ese orden y conserva 83 campos independientes, con nombres `a_p{p}_w{i}`. Se separaron campos que tenían nombres/padres compartidos para evitar que documento, aclaración y detalle PEP se sobrescribieran entre sí. Se borraron valores predeterminados (por ejemplo PEP=No) y se repararon las apariencias de casillas vacías.

- `layout.js`: posiciones exactas, nombres originales, IDs independientes y correspondencias de los 83 widgets.
- `core.js`: opciones, datos, lectura de mail, validación y correspondencias de campos compuestos.
- `pdf.js`: imprime respuestas completas; los campos vacíos o parcialmente respondidos siguen editables. Un documento con tipo pero sin número conserva el tipo dentro de la casilla editable. No corta textos que excedan el espacio: avisa para acortarlos.
- `import.js`: lee campos editables, texto por posición y OCR de los anexos; utiliza las bibliotecas locales de `assets/import`. Detecta BCV/BSGFCI en PDFs individuales y unidos. En imágenes o PDFs de una página, el usuario indica cuál de las seis páginas corresponde. Las lecturas dudosas y discrepancias pasan por revisión.
- `ui.js`: controles, revisión de candidatos y descarga del PDF unido.

Los campos de Firma no se importan ni se completan con texto del cliente. Permanecen reservados para firmar. Los datos comunes se repiten en ambos anexos; los números de cuenta y las casillas de carácter se distinguen por entidad. No se supone país, fecha, carácter ni respuesta PEP si no se aportaron. Los tipos de documento, sexo, estado civil e impuestos usan sugerencias editables porque los originales permiten texto libre; PEP conserva las opciones Sí/No. No se necesita compilación, API ni credenciales adicionales.

Para revisar cambios, servir la raíz del repositorio con `python3 -m http.server 8001 --bind 127.0.0.1` y ejecutar `python3 tests/apoderados_smoke.py`. Requiere Playwright y Chromium; admite `BALANZ_TEST_URL` y `CHROMIUM_PATH`. Las pruebas usan datos sintéticos y cubren orden de páginas, mail, opciones, PEP, campos parciales guardables, importación y OCR, descarga y navegación.
