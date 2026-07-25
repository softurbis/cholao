-- =====================================================================
-- Sistema Cholao — El cuadre real de la caja de Juan (v30)
--
-- POR QUÉ: el saldo que calcula el sistema (recibió − compras − entregas) SIEMPRE
-- va a cuadrar, porque es aritmética sobre lo que él mismo registró. Si falta
-- plata, el número no se entera. El único control de verdad es CONTAR el efectivo
-- que le queda en la mano y compararlo contra lo que debería tener.
--
-- `efectivo_contado` es ese conteo físico. La diferencia (contado − calculado) es
-- lo que Cesar mira: 0 = cuadra; negativo = falta plata; positivo = sobra
-- (normalmente una compra que no se registró).
--
-- Ejecutar DESPUÉS de 29_juan_lee_listas.sql.
-- =====================================================================

alter table fondo_compras_dia add column if not exists efectivo_contado numeric(12,2);
comment on column fondo_compras_dia.efectivo_contado is
  'Efectivo FÍSICO contado al cerrar el día. La diferencia contra vuelto_saldo es el descuadre real.';
