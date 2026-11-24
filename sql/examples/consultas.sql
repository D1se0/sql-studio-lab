-- Consultas de ejemplo sobre la base 'quickstart'.
-- Ábrelas en SQL Studio (Abrir → consultas.sql) o ejecuta: ./sql-lab run sql/examples/consultas.sql quickstart

USE quickstart;

-- 1. Pedidos con el nombre del cliente y su total
SELECT p.id AS pedido,
       c.nombre AS cliente,
       p.fecha,
       p.estado,
       SUM(l.cantidad * l.precio_unit) AS total
FROM pedidos p
JOIN clientes c ON c.id = p.cliente_id
JOIN lineas_pedido l ON l.pedido_id = p.id
GROUP BY p.id, c.nombre, p.fecha, p.estado
ORDER BY p.fecha DESC;

-- 2. Productos más vendidos (sin contar pedidos cancelados)
SELECT pr.nombre,
       pr.categoria,
       SUM(l.cantidad) AS unidades,
       SUM(l.cantidad * l.precio_unit) AS ingresos
FROM lineas_pedido l
JOIN productos pr ON pr.id = l.producto_id
JOIN pedidos p ON p.id = l.pedido_id AND p.estado <> 'cancelado'
GROUP BY pr.id, pr.nombre, pr.categoria
ORDER BY unidades DESC, ingresos DESC;

-- 3. Resumen por país
SELECT pais,
       COUNT(*) AS clientes,
       SUM(pedidos) AS pedidos,
       ROUND(SUM(total_gastado), 2) AS total
FROM resumen_clientes
GROUP BY pais
ORDER BY total DESC;

-- 4. Clientes sin pedidos
SELECT c.nombre, c.email
FROM clientes c
LEFT JOIN pedidos p ON p.cliente_id = c.id
WHERE p.id IS NULL;
