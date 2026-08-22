# Detailed description — Español (`es`)

Paste the block below into **Store listing → Description**, with the language
dropdown set to Spanish. It is plain text: the store keeps line breaks and
renders nothing else, so the bullets and headings are literal characters.

```text
HeaderLab establece, añade y elimina cabeceras HTTP de petición y respuesta en los sitios que tú elijas, usando el propio motor declarativeNetRequest de Chrome. No tiene acceso a ningún sitio hasta que tú se lo concedes.

QUÉ HACE

• Establecer, añadir o eliminar cualquier cabecera, del lado de la petición o del de la respuesta.
• Acotar por sitio. Los sitios se identifican por host, así que lo que muestra el popup es lo que sale por el cable.
• Aplicar en todas partes, como un modo explícito. Cuesta el acceso a todos los sitios, y el interruptor no lo solicita — lo solicita un botón Grant aparte.
• Filtrar por tipo de petición. Ocho de los tipos de recurso de Chrome, cada uno con su propia casilla, main_frame incluido, al que el valor por defecto de Chrome deja fuera en silencio.
• Pausar todo con un solo interruptor. El icono de la barra de herramientas se atenúa para acompañarlo, y sigue atenuado tras reiniciar el navegador.

MANÉJALO DESDE UN AGENTE DE PROGRAMACIÓN CON IA

HeaderLab incluye una herramienta de línea de comandos opcional y una skill para Claude Code y Codex, así que un agente puede leer y cambiar tus reglas de cabeceras mientras trabaja. Pídeselo con tus palabras — añade una cabecera X-Debug y acótala a staging.example.com, o deja de enviar Referer a la API — y el resultado aparece en el popup igual que si lo hubieras escrito tú.

No renuncias a ningún control: el puente está apagado hasta que enciendes su interruptor en el popup, la herramienta no puede ni encenderse sola ni conceder acceso a un sitio — Chrome acepta ambas cosas solo de tu propio clic — y se comunica por un socket local, nunca por una red.

QUÉ NO HACE

• Ninguna llamada de red. Sin analítica, sin telemetría, sin configuración remota, sin pings de actualización.
• Ningún content script. No se inyecta nada en ninguna página, y la extensión nunca ve el contenido de una página.
• Ningún código remoto, ningún CDN, ninguna fuente web, ninguna imagen remota. Nada se descarga desde fuera del paquete.
• Nada sale de tu máquina. Tus reglas se guardan en el propio almacenamiento de extensiones de Chrome.

https://github.com/say8425/headerlab

Código abierto, Apache-2.0.
```

## How this was produced

Translated from [`description.en.md`](description.en.md). The first version was
reviewed against the English source and revised — 17 issues were raised on this
locale and applied.

**The 2026-08-22 rewrite did not go through that reviewer stage.** It was
translated straight from the new English, in the same pass that wrote it, so
this file is worth a proofread before it is pasted into the dashboard — the
structural guard below cannot read meaning. Terminology follows
[`../README.es.md`](../README.es.md), the project's own README in this language, so a
reader arriving from the repository meets the same words.

`tests/unit/storeListing.test.ts` holds the structure to the English source:
the same number of bullets in the same order, every verbatim token intact, and
no Markdown that would render as literal junk in the store. Edit the prose
freely; that test is what stops an edit quietly breaking the shape.

**The English file is the source.** If a claim changes, change
`description.en.md` first and bring the five into line from there — five
descriptions making four different promises about the same extension is the
failure this ordering exists to prevent.
