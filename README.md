# Live Set

PWA de partituras y setlists con herramientas de ensayo y almacenamiento local offline.

Publicación: GitHub Pages desde `main`, carpeta raíz.

## Salas

La aplicación necesita un servidor WebSocket compatible con servidor 7 (`hello.app=liveset`, `pset`, `pstage`, blobs, endpoint `/sync`). GitHub Pages aloja la interfaz pero no ejecuta ese servidor. En Sala se debe indicar su dirección HTTPS/WSS. Si se configura ALLOWED_ORIGINS, permitir `https://rorycreator.github.io`.

Las partituras importadas se almacenan en IndexedDB del dispositivo: no se publican en este repositorio. Instalar o abrir la aplicación mediante HTTPS, esperar «Disponible sin conexión» y luego se puede usar el lector offline. Las salas necesitan conectividad al servidor.
