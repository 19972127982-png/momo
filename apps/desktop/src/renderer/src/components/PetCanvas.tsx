import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import { createPet, type PetController } from '../live2d/modelLoader'
import type { StateKey } from '../live2d/states'

export interface PetCanvasHandle {
  playState: (key: StateKey) => void
}

interface PetCanvasProps {
  onReady?: () => void
  onError?: (err: Error) => void
}

const PetCanvas = forwardRef<PetCanvasHandle, PetCanvasProps>(function PetCanvas(
  { onReady, onError },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controllerRef = useRef<PetController | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      playState: (key) => {
        controllerRef.current?.playState(key)
      }
    }),
    []
  )

  useEffect(() => {
    let cancelled = false
    const canvas = canvasRef.current
    if (!canvas) return

    createPet(canvas)
      .then((ctrl) => {
        if (cancelled) {
          ctrl.destroy()
          return
        }
        controllerRef.current = ctrl
        onReady?.()
      })
      .catch((err: Error) => {
        if (!cancelled) onError?.(err)
        console.error('[PetCanvas] createPet failed', err)
      })

    return () => {
      cancelled = true
      controllerRef.current?.destroy()
      controllerRef.current = null
    }
  }, [onReady, onError])

  return <canvas ref={canvasRef} className="pet-canvas" />
})

export default PetCanvas
