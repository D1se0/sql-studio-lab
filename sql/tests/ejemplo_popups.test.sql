-- Banco de pruebas de ejemplo: procedimientos, trigger y prints.
-- Lánzalo con:  ./sql-lab test sql/tests/ejemplo_popups.test.sql
--
-- Todo lo que va antes del primer '-- @test:' es el preámbulo y se ejecuta
-- una sola vez (tablas, datos, PROCEDURE, TRIGGER).
USE quickstart;

DROP TABLE IF EXISTS cuentas;
CREATE TABLE cuentas (
    id      INT AUTO_INCREMENT PRIMARY KEY,
    titular VARCHAR(60)   NOT NULL,
    saldo   DECIMAL(10,2) NOT NULL DEFAULT 0
);

INSERT INTO cuentas (titular, saldo) VALUES ('Ana', 100.00), ('Luis', 50.00);

DROP PROCEDURE IF EXISTS CheckAndAlert;
DELIMITER //

CREATE PROCEDURE CheckAndAlert(IN input_val INT)
BEGIN
    IF input_val < 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'El valor no puede ser negativo, por favor verifique e intente nuevamente.';
    END IF;

    SELECT 'Operación exitosa' AS result;
END //

CREATE TRIGGER trg_saldo_no_negativo
BEFORE UPDATE ON cuentas
FOR EACH ROW
BEGIN
    IF NEW.saldo < 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'El saldo no puede quedar en negativo';
    END IF;
END //

DELIMITER ;

-- @test: valor negativo lanza el popup de error
-- @expect-error: 45000 El valor no puede ser negativo
CALL CheckAndAlert(-1);

-- @test: valor positivo devuelve el print
-- @expect-ok
-- @expect-output: Operación exitosa
CALL CheckAndAlert(10);

-- @test: otro negativo (mensaje completo comprobado)
-- @expect-error: 45000 verifique e intente nuevamente
CALL CheckAndAlert(-42);

-- @test: el trigger corta una actualización que dejaría el saldo negativo
-- @expect-error: 45000 El saldo no puede quedar en negativo
UPDATE cuentas SET saldo = saldo - 500 WHERE titular = 'Luis';

-- @test: el saldo sigue intacto tras el intento fallido
-- @expect-ok
-- @expect-output: 50.00
SELECT titular, saldo FROM cuentas WHERE titular = 'Luis';

-- @test: una actualización válida pasa y se ve el nuevo saldo
-- @expect-ok
-- @expect-output: 40.00
UPDATE cuentas SET saldo = saldo - 10 WHERE titular = 'Luis';
SELECT titular, saldo FROM cuentas WHERE titular = 'Luis';
