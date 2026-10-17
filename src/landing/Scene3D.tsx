import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/**
 * Decorative hero scene. It does NOT represent live infrastructure data: the droplet, ribbons and
 * map nodes only illustrate the idea of scattered reports becoming organised intelligence.
 */

function Environment() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const room = new RoomEnvironment()
    const target = pmrem.fromScene(room, 0.04)
    scene.environment = target.texture
    return () => {
      scene.environment = null
      target.dispose()
      pmrem.dispose()
      room.dispose()
    }
  }, [gl, scene])
  return null
}

/** Teardrop profile for LatheGeometry: pointed top, round bottom. */
function dropProfile(): THREE.Vector2[] {
  const pts: THREE.Vector2[] = []
  const N = 48
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * Math.PI
    const x = Math.sin(th) * Math.pow(Math.sin(th / 2), 1.1)
    const y = Math.cos(th)
    pts.push(new THREE.Vector2(Math.max(x, 0) * 1.05, y * 1.3))
  }
  return pts
}

function Droplet() {
  const geo = useMemo(() => new THREE.LatheGeometry(dropProfile(), 72), [])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <mesh geometry={geo} position={[0, 0, 0]} scale={1.3}>
      <meshPhysicalMaterial
        color="#d6fbff"
        transmission={1}
        thickness={1.6}
        ior={1.33}
        roughness={0.03}
        metalness={0}
        clearcoat={1}
        clearcoatRoughness={0.04}
        attenuationColor="#00C2D1"
        attenuationDistance={2.2}
        envMapIntensity={1.6}
      />
    </mesh>
  )
}

function Ribbon({ radius, tilt, phase, color, opacity }: { radius: number; tilt: number; phase: number; color: string; opacity: number }) {
  const geo = useMemo(() => {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i < 80; i++) {
      const a = (i / 80) * Math.PI * 2
      pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a * 2 + phase) * 0.35, Math.sin(a) * radius))
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, 0.035, 8, true)
  }, [radius, phase])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <mesh geometry={geo} rotation={[tilt, 0, tilt * 0.6]}>
      <meshStandardMaterial color={color} emissive="#00C2D1" emissiveIntensity={0.45} transparent opacity={opacity} roughness={0.25} metalness={0.1} />
    </mesh>
  )
}

function Particles({ count }: { count: number }) {
  const geo = useMemo(() => {
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const r = 1.9 + Math.random() * 1.7
      const th = Math.random() * Math.PI * 2
      const ph = Math.acos(2 * Math.random() - 1)
      pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.9, r * Math.sin(ph) * Math.sin(th)], i * 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [count])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <points geometry={geo}>
      <pointsMaterial color="#45E6E0" size={0.045} sizeAttenuation transparent opacity={0.85} depthWrite={false} />
    </points>
  )
}

const NODES: [number, number, number][] = [
  [2.1, 0.9, 0.6],
  [2.35, 0.55, 0.9],
  [-2.2, -0.2, 0.8],
  [1.2, -1.7, 1.2],
  [-1.6, 1.4, 0.4],
]

function MapNodes() {
  const rings = useRef<(THREE.Mesh | null)[]>([])
  const linkGeo = useMemo(() => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...NODES[0]), new THREE.Vector3(...NODES[1])]), [])
  const line = useMemo(() => new THREE.Line(linkGeo, new THREE.LineBasicMaterial({ color: '#45E6E0', transparent: true, opacity: 0.8 })), [linkGeo])
  useEffect(() => () => { linkGeo.dispose(); (line.material as THREE.Material).dispose() }, [linkGeo, line])
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    rings.current.forEach((m, i) => {
      if (!m) return
      const s = 1 + 0.35 * Math.sin(t * 1.6 + i)
      m.scale.set(s, s, s)
    })
  })
  return (
    <group>
      {NODES.map((p, i) => (
        <group key={i} position={p}>
          <mesh>
            <sphereGeometry args={[0.07, 16, 16]} />
            <meshBasicMaterial color={i < 2 ? '#38B878' : '#45E6E0'} />
          </mesh>
          <mesh ref={(m) => (rings.current[i] = m)} rotation={[0, 0, 0]}>
            <ringGeometry args={[0.13, 0.16, 32]} />
            <meshBasicMaterial color="#45E6E0" transparent opacity={0.7} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
      <primitive object={line} />
    </group>
  )
}

function Rig({ children, animate }: { children: React.ReactNode; animate: boolean }) {
  const group = useRef<THREE.Group>(null)
  const orbit = useRef<THREE.Group>(null)
  useFrame(({ clock, pointer }) => {
    if (!animate || !group.current || !orbit.current) return
    const t = clock.getElapsedTime()
    group.current.rotation.y += (pointer.x * 0.35 - group.current.rotation.y) * 0.04
    group.current.rotation.x += (-pointer.y * 0.2 - group.current.rotation.x) * 0.04
    group.current.position.y = Math.sin(t * 0.8) * 0.08
    orbit.current.rotation.y = t * 0.12
  })
  return (
    <group ref={group}>
      <group ref={orbit}>{children}</group>
    </group>
  )
}

export default function Scene3D({ active, reduced, onReady, onFail }: { active: boolean; reduced: boolean; onReady: () => void; onFail: () => void }) {
  const small = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 640px)').matches
  const animate = active && !reduced
  return (
    <Canvas
      className="!absolute inset-0"
      frameloop={animate ? 'always' : 'demand'}
      dpr={small ? 1 : [1, 1.5]}
      camera={{ position: [0, 0, 7.3], fov: 45 }}
      gl={{ antialias: !small, alpha: true, powerPreference: 'default' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.05
        gl.domElement.addEventListener('webglcontextlost', (e) => {
          e.preventDefault()
          onFail()
        })
        requestAnimationFrame(() => requestAnimationFrame(onReady))
      }}
      aria-hidden="true"
    >
      <Environment />
      <ambientLight intensity={0.5} />
      <pointLight position={[3, 3, 4]} intensity={30} color="#45E6E0" />
      <pointLight position={[-4, -2, 3]} intensity={18} color="#0B7BC4" />
      <Rig animate={animate}>
        <Ribbon radius={2.0} tilt={0.5} phase={0} color="#00C2D1" opacity={0.7} />
        <Ribbon radius={2.4} tilt={-0.7} phase={2} color="#45E6E0" opacity={0.45} />
        <Ribbon radius={1.7} tilt={1.1} phase={4} color="#0B7BC4" opacity={0.6} />
        <Particles count={small ? 110 : 260} />
        <MapNodes />
      </Rig>
      <Droplet />
    </Canvas>
  )
}
