# Seguridad

## Modelo de amenaza

SQL Studio Lab es una herramienta **local**. La API y MySQL escuchan en
`127.0.0.1` y no hay autenticación de usuarios: quien pueda ejecutar procesos en
tu máquina ya tiene acceso a Docker y, por tanto, a los datos. Por eso el
proyecto no intenta protegerte de un usuario local malicioso; intenta evitar
errores, fugas accidentales y exposición en red.

- No publiques los puertos `8765` ni `3306` en Internet.
- Si necesitas acceso remoto, usa SSH (`ssh -L 8765:127.0.0.1:8765`) o una VPN.
- No reutilices la contraseña de root de MySQL para nada más.
- Revisa los `.sql` que importas: se ejecutan con permisos de root dentro del
  contenedor.

## Medidas implementadas

- Enlace por defecto a `127.0.0.1` (`SQL_STUDIO_HOST` solo si sabes lo que haces).
- `.env` generado con `umask 077` y excluido por `.gitignore`.
- Validación de nombres de bases y de ficheros `.sql`; prohibido `..`, `/` y
  rutas absolutas.
- Escritura atómica de ficheros (`.tmp` + `os.replace`).
- Identificadores citados; orden solo si coincide con una columna real; filtros
  con literales `LIKE` escapados.
- Sin dependencias de Python y con el frontend compilado localmente.

## Limitaciones conocidas

- Cualquier proceso local puede llamar a la API y ejecutar SQL.
- El contenedor usa `root` de MySQL (es un laboratorio, no producción).
- `docker exec` implica que el usuario del host pertenece al grupo `docker`,
  lo que equivale a privilegios de root en el host. Es el compromiso habitual
  de Docker; si no es aceptable, ejecuta el proyecto en una máquina virtual.

## Reportar una vulnerabilidad

Abre un issue privado de seguridad en GitHub (Security → Advisories) o contacta
con los mantenedores. Incluye versión, pasos de reproducción e impacto. No
publiques detalles explotables hasta que haya un parche.

Este proyecto no ofrece SLA, pero se agradece la divulgación responsable.
