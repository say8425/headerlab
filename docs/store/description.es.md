# Detailed description — Español (`es`)

Paste the block below into **Store listing → Description**, with the language
dropdown set to Spanish. It is plain text: the store keeps line breaks and
renders nothing else, so the bullets and headings are literal characters.

```text
HeaderLab establece, añade y elimina cabeceras HTTP de petición y respuesta en los sitios que tú elijas, usando el propio motor declarativeNetRequest de Chrome.

No pide nada al instalarse. El manifiesto solicita exactamente dos permisos — "storage" y "declarativeNetRequestWithHostAccess" — y ningún acceso a sitios en absoluto. Un sitio solo puede modificarse después de que pulses Grant en la fila que lo nombra, y puedes revocar ese acceso desde Chrome en cualquier momento.

QUÉ HACE

• Establecer, añadir o eliminar cualquier cabecera, del lado de la petición o del de la respuesta.
• Acotar por sitio. Los sitios se identifican por host, así que un puerto o una ruta se descartan al añadir el sitio — lo que muestra el popup es lo que sale por el cable.
• Aplicar en todas partes, como un modo explícito y no como una lista de sitios vacía. El modo cuesta el acceso a todos los sitios, y el interruptor no lo solicita: lo solicita un botón Grant aparte, y mientras no lo pulses la fila lo advierte.
• Filtrar por tipo de petición. Ocho de los tipos de recurso de Chrome, cada uno con su propia casilla. main_frame viene activado, porque el valor por defecto de Chrome lo deja fuera en silencio.
• Pausar todo con un solo interruptor. El icono de la barra de herramientas se atenúa para acompañarlo, y sigue atenuado después de reiniciar el navegador.
• Seguir la configuración clara u oscura de tu sistema operativo, antes del primer pintado.

NADA FALLA EN SILENCIO

Cualquier cosa que impida que una regla salga se dice en la fila de esa misma regla y se cuenta junto al encabezado «Rules» — un permiso que falta, un nombre de host inservible, un nombre de cabecera que Chrome va a rechazar.

El recuento no se maquilla. Una regla cuyo ámbito son solo hosts a los que no has concedido acceso se cuenta como bloqueada, nunca como activa, y junto al recuento se nombran los hosts que siguen esperando.

Esto importa más de lo que parece. Chrome acepta o rechaza el conjunto de reglas entero y no regla por regla, así que una sola fila defectuosa puede impedir que se apliquen todas las demás. HeaderLab nombra la fila y dice qué hacer en su lugar.

QUÉ NO HACE

• Ninguna llamada de red. Sin analítica, sin telemetría, sin configuración remota, sin pings de actualización.
• Ningún content script. No se inyecta nada en ninguna página, y la extensión nunca recibe el contenido de una página.
• Ningún código remoto. Nada se descarga ni se ejecuta desde fuera del paquete.
• Ningún recurso externo. Sin CDN, sin fuentes web, sin imágenes remotas.
• Nada sale de tu máquina. Tus reglas se guardan en el propio almacenamiento de extensiones de Chrome.

El código fuente es público, así que no hace falta creerse nada de lo anterior a ciegas:
https://github.com/say8425/headerlab

OPCIONAL: MANEJARLO DESDE UNA TERMINAL

Una herramienta de línea de comandos aparte y opcional puede aplicar cambios en las reglas por ti — útil si prefieres teclear antes que hacer clic, o si quieres que un asistente de programación con IA establezca una cabecera mientras trabaja. Está apagada hasta que enciendas su interruptor en el popup, necesita un programa auxiliar que instalas tú mismo, y se comunica por un socket local en tu propia máquina, en lugar de por una red. No toques el interruptor y no se ejecuta nada de esto.

Código abierto, Apache-2.0.
```

## How this was produced

Translated from [`description.en.md`](description.en.md), then reviewed against
the English source and revised — 17 issues were raised on this
locale and applied. Terminology follows [`../README.es.md`](../README.es.md),
the project's own README in this language, so a reader arriving from the
repository meets the same words.

`tests/unit/storeListing.test.ts` holds the structure to the English source:
the same number of bullets in the same order, every verbatim token intact, and
no Markdown that would render as literal junk in the store. Edit the prose
freely; that test is what stops an edit quietly breaking the shape.

**The English file is the source.** If a claim changes, change
`description.en.md` first and bring the five into line from there — five
descriptions making four different promises about the same extension is the
failure this ordering exists to prevent.
