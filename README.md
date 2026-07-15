# Sistema Cholao — Control de sedes

Sistema de control (puro números) para el negocio **El Cholao**. No es un POS:
consolida por sede lo que ya se opera en otros lados.

## Módulos
1. **Cuadre diario** — concilia ventas por medio de pago (efectivo · Yape · Plin · tarjeta) vs. arqueo; detecta faltantes/sobrantes por sede y día.
2. **Compras** — cada sede arma su lista desde el celular → lista general → Juan consolida → compra. Aparte: faltantes de almacén (frutas, etc.) que compra el dueño, entran a almacén y se reparten.
3. **Asistencia · Planilla** — marca de entrada/salida por persona y sede → base de la planilla.
4. **Ventas** — histórico importado del sistema de ventas actual; alimenta el cuadre y el panel.

## Stack
React 19 · Vite 6 · React Router 7 · Supabase (Postgres + Auth). CSS plano.
Mismo stack que el CRM de Urbis para reusar conocimiento.

## Puesta en marcha
```bash
cd app
npm install
cp .env.example .env   # completar con las credenciales de Supabase
npm run dev            # http://localhost:5174
```

## Base de datos
Ejecutar `sql/01_base_schema.sql` en el SQL Editor de Supabase (crea sedes, personas, perfiles y el enum de roles).

## Roles
`superadmin` (tú) · `gerente` · `encargado` (sede) · `compras` (Juan) · `almacen` · `cajera`.
El acceso a cada módulo se define en `app/src/lib/roles.js`.

## Estado
Estructura base montada (login, layout por rol, páginas de los 4 módulos como esqueleto).
Pendiente para llenar de verdad:
- Excel del **cuadre diario** actual (para calcar campos).
- **Lista de compras** frecuente (para precargar el módulo de compras).
- Muestra de **export del sistema de ventas** actual.
- Credenciales de **Supabase** en `.env`.
