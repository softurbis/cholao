import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import RegistrarCaja from './pages/RegistrarCaja'
import Config from './pages/Config'
import Cuadre from './pages/Cuadre'
import Compras from './pages/Compras'
import Asistencia from './pages/Asistencia'
import Ventas from './pages/Ventas'
import Productos from './pages/Productos'
import Gastos from './pages/Gastos'
import Sedes from './pages/Sedes'
import Personas from './pages/Personas'

function Privado({ module, children }) {
  return (
    <ProtectedRoute module={module}>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Privado><Dashboard /></Privado>} />
        <Route path="/registrar-caja" element={<Privado module="registro"><RegistrarCaja /></Privado>} />
        <Route path="/config" element={<Privado module="config"><Config /></Privado>} />
        <Route path="/cuadre" element={<Privado module="cuadre"><Cuadre /></Privado>} />
        <Route path="/compras" element={<Privado module="compras"><Compras /></Privado>} />
        <Route path="/asistencia" element={<Privado module="asistencia"><Asistencia /></Privado>} />
        <Route path="/ventas" element={<Privado module="ventas"><Ventas /></Privado>} />
        <Route path="/productos" element={<Privado module="productos"><Productos /></Privado>} />
        <Route path="/gastos" element={<Privado module="gastos"><Gastos /></Privado>} />
        <Route path="/sedes" element={<Privado module="sedes"><Sedes /></Privado>} />
        <Route path="/personas" element={<Privado module="personas"><Personas /></Privado>} />
      </Routes>
    </AuthProvider>
  )
}
