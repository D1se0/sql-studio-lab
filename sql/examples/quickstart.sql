-- SQL Studio Lab · datos de ejemplo
-- Carga:  ./sql-lab load sql/examples/quickstart.sql
-- Crea cuatro tablas relacionadas para probar el mapa de esquema,
-- el inspector de tablas y las consultas con JOIN.

CREATE DATABASE IF NOT EXISTS quickstart
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE quickstart;

DROP VIEW IF EXISTS resumen_clientes;
DROP TABLE IF EXISTS lineas_pedido;
DROP TABLE IF EXISTS pedidos;
DROP TABLE IF EXISTS productos;
DROP TABLE IF EXISTS clientes;

CREATE TABLE clientes (
    id      INT AUTO_INCREMENT PRIMARY KEY,
    nombre  VARCHAR(80)  NOT NULL,
    email   VARCHAR(120) NOT NULL UNIQUE,
    pais    VARCHAR(40)  NOT NULL,
    alta    DATE         NOT NULL
) ENGINE=InnoDB;

CREATE TABLE productos (
    id       INT AUTO_INCREMENT PRIMARY KEY,
    nombre   VARCHAR(80)   NOT NULL,
    categoria VARCHAR(40)  NOT NULL,
    precio   DECIMAL(10,2) NOT NULL,
    stock    INT           NOT NULL DEFAULT 0,
    INDEX idx_productos_categoria (categoria)
) ENGINE=InnoDB;

CREATE TABLE pedidos (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    cliente_id INT  NOT NULL,
    fecha      DATE NOT NULL,
    estado     ENUM('pendiente','pagado','enviado','cancelado') NOT NULL DEFAULT 'pendiente',
    CONSTRAINT fk_pedidos_cliente
        FOREIGN KEY (cliente_id) REFERENCES clientes (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_pedidos_fecha (fecha)
) ENGINE=InnoDB;

CREATE TABLE lineas_pedido (
    pedido_id   INT NOT NULL,
    producto_id INT NOT NULL,
    cantidad    INT NOT NULL DEFAULT 1,
    precio_unit DECIMAL(10,2) NOT NULL,
    PRIMARY KEY (pedido_id, producto_id),
    CONSTRAINT fk_lineas_pedido
        FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE CASCADE,
    CONSTRAINT fk_lineas_producto
        FOREIGN KEY (producto_id) REFERENCES productos (id) ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO clientes (nombre, email, pais, alta) VALUES
    ('Ana Torres',      'ana@example.com',      'España',   '2024-01-12'),
    ('Luis Fernández',  'luis@example.com',     'España',   '2024-02-03'),
    ('Marta Ruiz',      'marta@example.com',    'Francia',  '2024-02-19'),
    ('Diego Salas',     'diego@example.com',    'México',   '2024-03-08'),
    ('Sofía Molina',    'sofia@example.com',    'Argentina','2024-03-22'),
    ('Pablo Ortega',    'pablo@example.com',    'Chile',    '2024-04-05');

INSERT INTO productos (nombre, categoria, precio, stock) VALUES
    ('Teclado mecánico',   'Periféricos', 89.90, 24),
    ('Ratón inalámbrico',  'Periféricos', 39.50, 51),
    ('Monitor 27"',        'Pantallas',  249.00, 12),
    ('Soporte de monitor', 'Accesorios',  45.00, 30),
    ('Cable USB-C',        'Accesorios',   9.99, 120),
    ('Webcam Full HD',     'Periféricos', 69.00, 18);

INSERT INTO pedidos (cliente_id, fecha, estado) VALUES
    (1, '2024-04-10', 'pagado'),
    (1, '2024-05-02', 'enviado'),
    (2, '2024-04-15', 'pendiente'),
    (3, '2024-05-20', 'pagado'),
    (4, '2024-06-01', 'cancelado'),
    (5, '2024-06-11', 'enviado'),
    (5, '2024-07-03', 'pendiente'),
    (6, '2024-07-18', 'pagado');

INSERT INTO lineas_pedido (pedido_id, producto_id, cantidad, precio_unit) VALUES
    (1, 1, 1, 89.90),
    (1, 5, 2, 9.99),
    (2, 3, 1, 249.00),
    (2, 4, 1, 45.00),
    (3, 2, 1, 39.50),
    (4, 6, 1, 69.00),
    (4, 5, 3, 9.99),
    (5, 1, 2, 89.90),
    (6, 2, 2, 39.50),
    (6, 5, 1, 9.99),
    (7, 3, 1, 249.00),
    (7, 4, 2, 45.00),
    (8, 6, 1, 69.00),
    (8, 1, 1, 89.90);

CREATE VIEW resumen_clientes AS
    SELECT c.id,
           c.nombre,
           c.pais,
           COUNT(DISTINCT p.id)    AS pedidos,
           COALESCE(SUM(l.cantidad * l.precio_unit), 0) AS total_gastado
    FROM clientes c
    LEFT JOIN pedidos p ON p.cliente_id = c.id AND p.estado <> 'cancelado'
    LEFT JOIN lineas_pedido l ON l.pedido_id = p.id
    GROUP BY c.id, c.nombre, c.pais;
