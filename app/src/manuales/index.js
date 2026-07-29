// Manuales por módulo. Cada pantalla lleva el suyo, accesible con el botón "❓ Manual".
//
// REGLA AL TOCAR EL CÓDIGO: si cambias cómo funciona un módulo, actualiza su manual
// AQUÍ en el mismo cambio, y agrega una línea a `novedades` con la fecha. El manual
// vive junto al código a propósito: así se actualiza cuando se actualiza la pantalla,
// y no queda un instructivo suelto que nadie mantiene.
//
// Estructura de cada manual:
//   titulo      — cómo se llama el módulo
//   paraQuien   — quién lo usa (para que cada quien sepa si le toca)
//   resumen     — una o dos frases: para qué sirve
//   pasos       — [{ t: título del paso, d: qué hacer }] en el orden real de uso
//   ojo         — advertencias y cosas que cuestan entender
//   novedades   — [{ f: 'YYYY-MM-DD', d: qué cambió }], lo más nuevo primero

export const MANUALES = {
  // -------------------------------------------------------------------
  lista: {
    titulo: 'Mi Lista',
    paraQuien: 'Cocina y personal de tienda. Gerencia la mira.',
    resumen: 'Aquí pides lo que le hace falta a tu sede, y confirmas lo que te llega.',
    pasos: [
      { t: 'Arma tu lista', d: 'Busca el producto y toca ➕ para sumar, ➖ para bajar. La unidad (kg, litro, unidad) sale sola.' },
      { t: 'Deja un comentario si hace falta', d: 'En el recuadro de arriba: "que la fresa sea grande", "urgente el hielo". Quien compra lo lee.' },
      { t: 'Envíala', d: 'Cuando esté completa, toca "Enviar lista". Al enviarla queda bloqueada para que nadie la cambie mientras se hacen las compras.' },
      { t: 'Confirma lo que llega', d: 'Abajo, en Recepción: conforme vaya llegando cada cosa, escribe cuánto recibiste y toca "Recibí". Puedes hacerlo de a poquitos, no esperes a que llegue todo.' },
      { t: 'Si llega algo que no pediste', d: 'Úsalo en "Recepción de emergencia" para que quede registrado igual.' },
    ],
    ojo: [
      'Si te equivocaste después de enviar, pide que la liberen: quien compra la desbloquea y la puedes corregir.',
      'En Recepción puedes anotar menos de lo que pediste (llegaron 15 de 20). Después completas el resto cuando llegue.',
      'La lista muestra "pidieron → compró → llegó", así ves si lo que te falta es porque no se compró o porque no ha llegado.',
    ],
    novedades: [
      { f: '2026-07-24', d: 'Se agregó la Recepción: ahora confirmas lo que te llega desde esta misma pantalla.' },
      { f: '2026-07-24', d: 'Gerencia ahora puede ver las listas de todas las sedes (solo mirar).' },
    ],
  },

  // -------------------------------------------------------------------
  compras: {
    titulo: 'Compras',
    paraQuien: 'Quien se encarga de las compras. Administración y gerencia también entran.',
    resumen: 'Todo lo de comprar: el día a día, la caja de compras, el almacén y los pedidos al por mayor.',
    pasos: [
      { t: '🛒 Comprar hoy — tu pantalla del día', d: 'Arriba ves cuánta plata te queda. Abajo, todo lo que pidieron las sedes. Toca un producto y elige qué hacer con él.' },
      { t: 'Antes de comprar: el comprobante', d: 'Al llegar al proveedor, toca arriba "¿Dónde estás comprando?", pon el nombre y toma la foto UNA vez. Todo lo que registres ahí se le engancha solo. Cuando te muevas a otro sitio, toca "Cambiar".' },
      { t: 'Las tres salidas de cada producto', d: 'Del almacén (si ya hay stock, se lo entregas a la sede) · Comprar (con la plata de tu caja) · Pedir abastecimiento (para que administración lo compre al por mayor; no sale plata tuya).' },
      { t: 'Al comprar', d: 'Ajusta la cantidad con + y −, pon el precio y elige a dónde va. El botón te muestra el total antes de guardar.' },
      { t: '💵 Caja de compras', d: 'Tu cuadre del día. El vuelto de ayer y el efectivo de la sede salen solos; tú registras los adicionales que te den y lo que entregues a gerencia. Al cerrar, cuenta tu efectivo y anótalo.' },
      { t: '📋 Abastecimiento', d: 'Lo que necesitas al por mayor. Lo armas y lo envías; administración lo compra e ingresa el stock al almacén.' },
      { t: '🔢 Conteo almacén', d: 'Cuenta lo que hay de verdad en el almacén y anótalo. Si no coincide con el sistema, se ajusta solo.' },
    ],
    ojo: [
      'La lista de las sedes es una GUÍA, no una orden: si pidieron 10 y a ti te conviene comprar 8, compra 8. Se guarda lo que compraste y la diferencia queda anotada.',
      'Si el precio que pones es muy distinto al que venías pagando, sale un aviso. No te bloquea: es para que revises que no se te fue un dedo (35 en vez de 3.50).',
      'Cuando compras algo y lo mandas DIRECTO a una sede, no pasa por el almacén y no descuenta stock. Solo lo que marcas "Almacén" entra al kardex.',
      'Tu saldo calculado siempre va a cuadrar, porque son restas de lo que tú mismo anotaste. Por eso hay que CONTAR el efectivo al cerrar: ahí recién se ve si falta.',
    ],
    novedades: [
      { f: '2026-07-24', d: 'Nueva pantalla "Comprar hoy": todo en una sola vista, pensada para el celular.' },
      { f: '2026-07-24', d: 'El comprobante se toma una vez por proveedor, ya no uno por producto.' },
      { f: '2026-07-24', d: 'Cada producto muestra cuánto hay en almacén, para no comprar lo que ya está guardado.' },
      { f: '2026-07-24', d: 'Nuevo conteo físico del almacén y el efectivo contado al cerrar caja.' },
    ],
  },

  // -------------------------------------------------------------------
  horarios: {
    titulo: 'Horarios',
    paraQuien: 'Todos ven el suyo. Administración y gerencia programan.',
    resumen: 'Quién trabaja cada día en cada sede, y cuántas horas le tocan.',
    pasos: [
      { t: 'Mi horario', d: 'Ves tu semana día por día: a qué hora entras, a qué hora sales y en qué sede. Abajo, el total de horas. Con las flechas te mueves de semana.' },
      { t: 'Programar (administración)', d: 'Elige la sede y la semana. En cada día toca "+ Agregar", elige a la persona y su turno. Hay atajos: Full, Mañana y Tarde.' },
      { t: 'Copiar la semana anterior', d: 'Trae toda la programación de la semana pasada de esa sede. Es lo que evita re-teclear todo cada lunes; después corriges solo lo que cambia.' },
      { t: 'Ver las horas', d: 'Abajo sale cuántas horas le tocan a cada quien esa semana y a cuánto equivale según su pago por hora.' },
    ],
    ojo: [
      'Los bonos y las horas extra NO se calculan aquí ni salen de la asistencia: se registran a mano en Gastos. Esto es solo la programación y la referencia de cuánto vale una hora.',
      'El pago por hora de cada persona se pone en Personas.',
      'Una persona puede tener dos bloques el mismo día (por ejemplo mañana y noche), pero no dos que empiecen a la misma hora.',
      'Si no ves tu horario, puede ser que tu usuario no esté enlazado a tu ficha de personal: avísale al administrador.',
    ],
    novedades: [
      { f: '2026-07-25', d: 'Módulo nuevo.' },
    ],
  },

  // -------------------------------------------------------------------
  asistencia: {
    titulo: 'Asistencia',
    paraQuien: 'Todo el personal marca. Gerencia y administración revisan.',
    resumen: 'Marca tu entrada y tu salida desde tu celular, con tu ubicación y una foto.',
    pasos: [
      { t: 'Toca "Marcar mi entrada"', d: 'El celular te va a pedir permiso de ubicación: dale que sí. Si no lo das, no puedes marcar.' },
      { t: 'Espera la ubicación', d: 'Tarda unos segundos. Si demora mucho, sal al aire libre: dentro del local el GPS agarra mal.' },
      { t: 'Tómate la foto', d: 'Se abre la cámara de adelante. Esa foto queda guardada con tu marca.' },
      { t: 'Al irte, marca tu salida', d: 'Mismo procedimiento. Arriba siempre ves a qué hora marcaste cada una.' },
    ],
    ojo: [
      'Solo puedes marcar si estás en tu sede. Si estás más lejos de lo permitido, te dice a cuántos metros estás y no te deja.',
      'Si tu celular no da la cámara o la ubicación, no puedes marcar: avísale a administración para que la registre a mano.',
      'Solo se puede marcar una entrada y una salida por día. Si tocas dos veces, no se duplica.',
      'Para administración: las marcas fuera del radio salen en rojo con los metros, y las registradas a mano salen señaladas con su motivo.',
    ],
    novedades: [
      { f: '2026-07-24', d: 'Módulo nuevo: antes esta pantalla estaba vacía.' },
    ],
  },

  // -------------------------------------------------------------------
  gastos: {
    titulo: 'Gastos',
    paraQuien: 'Quien registra los gastos, y gerencia y administración (que además ven todo).',
    resumen: 'Gastos de la tienda y adelantos, descuentos y bonos del personal, cada uno con su comprobante.',
    pasos: [
      { t: 'Primero: ¿qué es?', d: 'Toca una: gasto de tienda (agua, luz, alquiler) o algo de una persona: adelanto, descuento o bono.' },
      { t: 'El comprobante, si corresponde', d: 'Solo el gasto de tienda y el adelanto lo piden, porque son los que mueven plata. Puedes tomar la foto ahí mismo o subir un archivo que ya tengas. Si fue en efectivo y no hay papel, toca "Sin comprobante — en efectivo".' },
      { t: '¿A quién o de qué?', d: 'Si es de una persona, la eliges de la lista. Si es gasto de tienda, escribes de qué se trata.' },
      { t: 'El monto', d: 'Escríbelo y guarda. El botón te muestra el monto antes de tocarlo.' },
      { t: 'Si hace falta cambiar algo más', d: 'La fecha, la sede o una nota están escondidas en "+ Cambiar fecha, sede o agregar nota", porque casi nunca se tocan.' },
      { t: 'Consolidado en PDF', d: 'Gerencia y administración tienen la pestaña "Consolidado" para imprimir el resumen del mes.' },
    ],
    ojo: [
      'Quien tiene solo el permiso de gastos ve únicamente lo que él mismo registró. Gerencia, administración y el superusuario ven todo.',
      'El histórico de 2026 aparece mezclado por fecha con lo nuevo, a propósito.',
      'La fecha se pone sola en el día de hoy. Si estás registrando algo de ayer, acuérdate de cambiarla.',
    ],
    novedades: [
      { f: '2026-07-24', d: 'El descuento y el bono ya no piden comprobante: son apuntes de planilla, no un pago.' },
      { f: '2026-07-24', d: 'El comprobante ahora se puede subir como archivo, no solo tomar la foto.' },
      { f: '2026-07-24', d: 'El formulario se rehizo para el celular: se elige tocando, casi sin teclado.' },
      { f: '2026-07-17', d: 'Se unificaron Gastos y Pagos en un solo módulo.' },
    ],
  },

  // -------------------------------------------------------------------
  registro: {
    titulo: 'Registrar Caja',
    paraQuien: 'Cajeras y encargados de cada sede.',
    resumen: 'Tu turno de caja, en tres momentos: abrir, trabajar, cerrar.',
    pasos: [
      { t: 'Apertura', d: 'Abre el turno con la base de caja (el efectivo con el que empiezas) y el stock inicial de productos.' },
      { t: 'Durante el turno', d: 'Vas anotando los gastos de tienda, los descuentos o adelantos del personal, y los traslados a otra sede si los hay.' },
      { t: 'Cierre', d: 'Cuentas la plata por medio de pago (efectivo, yape, tarjeta), subes los documentos que se piden y cierras. El sistema compara contra lo que dice el POS.' },
    ],
    ojo: [
      'El turno se firma con el usuario que inició sesión: ya no se escribe el nombre a mano.',
      'La sede y el turno se preseleccionan según la hora, pero revísalos antes de abrir.',
      'Después administración valida tu caja. Si algo no cuadra, te lo van a observar ahí.',
    ],
    novedades: [
      { f: '2026-07-17', d: 'Cada sede define sus propios turnos y horarios (Amazonas 2 turnos, Miraflores 1).' },
    ],
  },

  // -------------------------------------------------------------------
  cuadre: {
    titulo: 'Caja Diaria',
    paraQuien: 'Administración y gerencia.',
    resumen: 'Todas las cajas de todas las sedes, para revisarlas y validarlas.',
    pasos: [
      { t: 'Revisa el turno', d: 'Entra al turno y mira la venta, los medios de pago, los gastos, los descuentos al personal y el stock.' },
      { t: 'Valida', d: 'Si está correcto, lo validas. Si no, se corrige antes.' },
    ],
    ojo: [
      'Gerencia solo mira; administración y el superusuario pueden editar y validar.',
      'Si un turno tiene montos editados a mano, queda marcado para que lo revises.',
    ],
    novedades: [],
  },

  // -------------------------------------------------------------------
  dashboard: {
    titulo: 'Panel de control',
    paraQuien: 'Gerencia, administración y superusuario.',
    resumen: 'El flujo de dinero del negocio, en números.',
    pasos: [
      { t: 'Mira el periodo', d: 'Elige el rango y la sede para ver cómo va el movimiento.' },
    ],
    ojo: [
      'El consolidado de gastos todavía no está integrado aquí: se ve en su propio módulo.',
    ],
    novedades: [],
  },

  // -------------------------------------------------------------------
  productos: {
    titulo: 'Productos más vendidos',
    paraQuien: 'Gerencia, administración y superusuario.',
    resumen: 'Ranking de lo que más se vende, por producto, categoría y canal.',
    pasos: [
      { t: 'Filtra', d: 'Elige la sede y el rango de meses para comparar.' },
    ],
    ojo: [
      'Sale de los tickets del POS importados. Si faltan meses, es que ese periodo no se ha cargado todavía.',
    ],
    novedades: [],
  },

  // -------------------------------------------------------------------
  ventas: {
    titulo: 'Ventas',
    paraQuien: 'Por construir.',
    resumen: 'Módulo pendiente. La pantalla documenta lo que le falta.',
    pasos: [],
    ojo: ['Todavía no se usa: falta el detalle ticket a ticket y el comparativo contada / sistema / POS.'],
    novedades: [],
  },

  // -------------------------------------------------------------------
  sedes: {
    titulo: 'Sedes',
    paraQuien: 'Solo el superusuario.',
    resumen: 'Los locales, sus turnos y su horario por día.',
    pasos: [
      { t: 'Turnos y horario', d: 'En la pestaña 🕒 defines cuántos turnos tiene cada sede y a qué hora abre y cierra cada día.' },
    ],
    ojo: [
      'Los turnos viejos no se borran, quedan inactivos, para no romper los datos históricos.',
    ],
    novedades: [],
  },

  // -------------------------------------------------------------------
  personas: {
    titulo: 'Personas',
    paraQuien: 'Solo el superusuario.',
    resumen: 'El personal y quién entra al sistema.',
    pasos: [
      { t: 'Registra a la persona', d: 'Sus datos van aquí primero.' },
      { t: 'Créale su acceso', d: 'Eliges cómo entra: "Usuario y PIN" para el personal de tienda (escriben su nombre y 6 números, sin correo) o "Correo y contraseña" para gerencia, administración o alguien de fuera. Después su rol y su sede.' },
      { t: 'Anota lo que sale', d: 'Al crearlo se muestra la clave UNA vez, para que se la dictes. No se guarda en ningún lado: si se pierde, se resetea desde aquí.' },
      { t: 'Permisos especiales', d: 'A una cajera le puedes marcar "puede gastos" (abre Gastos) o "puede compras" (abre Compras), sin cambiarle el rol.' },
    ],
    ojo: [
      'Los desactivados quedan abajo, no se borran.',
      'El rol define qué módulos ve. Gerencia solo mira; administración edita y valida.',
      'El PIN lo pone el sistema a propósito: si lo eligiera cada quien, la mitad pondría 123456.',
      'El pago por hora que pongas aquí es la referencia que usa Horarios para estimar las horas extra.',
    ],
    novedades: [
      { f: '2026-07-26', d: 'Ahora se puede crear el acceso con un correo real, no solo con usuario y PIN.' },
      { f: '2026-07-25', d: 'Se agregó el pago por hora de cada persona.' },
    ],
  },

  // -------------------------------------------------------------------
  config: {
    titulo: 'Configuración',
    paraQuien: 'Solo el superusuario.',
    resumen: 'Productos de stock, metas por sede y turno, y días de inventario.',
    pasos: [
      { t: 'Metas', d: 'Defines cuánto debería vender cada sede por día de la semana y turno.' },
      { t: 'Días de inventario', d: 'Marcas en qué días toca el conteo físico.' },
    ],
    ojo: [],
    novedades: [],
  },
}

export function getManual(key) {
  return MANUALES[key] || null
}
