-- =====================================================================
-- Sistema Cholao — Compras al contado vs crédito + Cuentas por pagar (v6)
-- Separa los dos "relojes": ALMACÉN (llega el producto) vs DINERO (se paga).
-- Ejecutar después de 04_compras_stock.sql
-- =====================================================================

-- Condición de pago en cada compra (recepción de mercadería)
alter table compras add column if not exists condicion_pago text not null default 'contado'; -- contado | credito
alter table compras add column if not exists acreedor       text;    -- "Tarjeta Primo", "La Peruanita"...
alter table compras add column if not exists estado_pago    text not null default 'pagado';   -- pagado | pendiente
alter table compras add column if not exists fecha_pago     date;    -- cuándo salió el dinero

-- Regla de negocio:
--   * contado  -> estado_pago='pagado',    fecha_pago=fecha   (sube stock Y sale del flujo)
--   * credito  -> estado_pago='pendiente', fecha_pago=null    (sube stock, NO sale del flujo aún)
-- El stock siempre sube al recibir (trigger de 04). El flujo se alimenta del
-- ledger de gastos (pagos reales), NO de estas recepciones -> sin doble conteo.

-- ---------------------------------------------------------------------
-- Cuentas por pagar: lo que llegó a crédito y aún no se paga
-- ---------------------------------------------------------------------
create or replace view vista_cuentas_por_pagar as
select
  coalesce(acreedor, proveedor, 'Sin acreedor') as acreedor,
  count(*)              as compras_pendientes,
  sum(total)            as deuda_total,
  min(fecha)            as compra_mas_antigua
from compras
where condicion_pago = 'credito' and estado_pago = 'pendiente'
group by 1
order by deuda_total desc;
