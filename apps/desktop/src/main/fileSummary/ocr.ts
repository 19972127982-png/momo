/**
 * 本地 OCR 封装（tesseract.js）—— 拖图片总结用
 *
 * 设计：
 *   - 懒初始化单例 worker（首次 OCR 才创建；创建会下载 wasm core + chi_sim/eng 语言包并缓存，
 *     首次需联网，之后走缓存）。
 *   - 中英混排用 'chi_sim+eng'。
 *   - 用动态 import 加载 tesseract.js —— 规避主进程 CJS bundle 直接 require ESM-only 包的问题。
 *   - 进程退出时 terminate，释放 worker 子线程。
 *
 * 不抛敏感细节：失败抛 Error，由上层转成人格化提示。
 */

// tesseract.js 的 Worker 类型不在这里强约束，用最小结构描述以保持解耦
interface TesseractWorkerLike {
  recognize(image: string): Promise<{ data: { text: string } }>
  terminate(): Promise<unknown>
}

let workerPromise: Promise<TesseractWorkerLike> | null = null

async function getWorker(): Promise<TesseractWorkerLike> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const tesseract = await import('tesseract.js')
      const createWorker = tesseract.createWorker
      // v5+ 签名：createWorker(langs, oem?, options?) —— 直接传语言，内部自动加载
      const worker = (await createWorker('chi_sim+eng')) as unknown as TesseractWorkerLike
      return worker
    })().catch((err) => {
      // 初始化失败要清掉缓存的 promise，下次可重试
      workerPromise = null
      throw err
    })
  }
  return workerPromise
}

/** 对图片文件做 OCR，返回识别出的文字（可能为空字符串） */
export async function ocrImage(imagePath: string): Promise<string> {
  const worker = await getWorker()
  const { data } = await worker.recognize(imagePath)
  return (data.text ?? '').trim()
}

/** 进程退出时调用，释放 worker */
export async function closeOcr(): Promise<void> {
  if (workerPromise) {
    const p = workerPromise
    workerPromise = null
    try {
      const worker = await p
      await worker.terminate()
    } catch {
      /* 忽略关闭异常 */
    }
  }
}
