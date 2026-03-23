class Button extends Container {
  constructor(options = {}) {
    const text = options.text || 'Button'
    const fontSize = parseInt(options.size) || 48
    const onClick = options.onClick || null
    const type = options.type || 'rounded' // "rounded", "circle", or "pill"
    const warp = options.warp !== undefined ? options.warp : false // Center warping disabled by default
    const tintOpacity = options.tintOpacity !== undefined ? options.tintOpacity : 0.2

    // Call parent constructor (border radius will be set in setSizeFromText)
    super({
      borderRadius: fontSize,
      type: type,
      tintOpacity: tintOpacity
    })

    this.text = text
    this.fontSize = fontSize
    this.onClick = onClick
    this.type = type
    this.warp = warp
    this.parent = null // Will be set if added to container
    this.isNestedGlass = false

    // Add button-specific styling and content
    this.element.classList.add('glass-button')
    if (this.type === 'circle') {
      this.element.classList.add('glass-button-circle')
    }
    this.createTextElement()
    this.setupClickHandler()
    this.setSizeFromText()
  }

  setSizeFromText() {
    let width, height

    if (this.type === 'circle') {
      const circleSize = this.fontSize * 2.5
      width = circleSize
      height = circleSize
      this.borderRadius = circleSize / 2

      this.element.style.width = width + 'px'
      this.element.style.height = height + 'px'
      this.element.style.minWidth = width + 'px'
      this.element.style.minHeight = height + 'px'
      this.element.style.maxWidth = width + 'px'
      this.element.style.maxHeight = height + 'px'
    } else if (this.type === 'pill') {
      const textMetrics = Button.measureText(this.text, this.fontSize)
      width = Math.ceil(textMetrics.width + this.fontSize * 2)
      height = Math.ceil(this.fontSize + this.fontSize * 1.2)
      this.borderRadius = height / 2
      this.element.style.minWidth = width + 'px'
      this.element.style.minHeight = height + 'px'
    } else {
      const textMetrics = Button.measureText(this.text, this.fontSize)
      width = Math.ceil(textMetrics.width + this.fontSize * 2)
      height = Math.ceil(this.fontSize + this.fontSize * 1.5)
      this.borderRadius = this.fontSize
      this.element.style.minWidth = width + 'px'
      this.element.style.minHeight = height + 'px'
    }

    this.element.style.borderRadius = this.borderRadius + 'px'

    if (this.canvas) {
      this.canvas.style.borderRadius = this.borderRadius + 'px'
    }

    if (this.type === 'circle') {
      this.width = width
      this.height = height

      if (this.canvas) {
        this.canvas.width = width
        this.canvas.height = height
        this.canvas.style.width = width + 'px'
        this.canvas.style.height = height + 'px'

        if (this.gl_refs.gl) {
          this.gl_refs.gl.viewport(0, 0, width, height)
          this.gl_refs.gl.uniform2f(this.gl_refs.resolutionLoc, width, height)
          this.gl_refs.gl.uniform1f(this.gl_refs.borderRadiusLoc, this.borderRadius)
        }
      }
    } else if (this.type === 'pill') {
      this.width = width
      this.height = height

      this.element.style.width = width + 'px'
      this.element.style.height = height + 'px'
      this.element.style.maxWidth = width + 'px'
      this.element.style.maxHeight = height + 'px'

      if (this.canvas) {
        this.canvas.width = width
        this.canvas.height = height
        this.canvas.style.width = width + 'px'
        this.canvas.style.height = height + 'px'

        if (this.gl_refs.gl) {
          this.gl_refs.gl.viewport(0, 0, width, height)
          this.gl_refs.gl.uniform2f(this.gl_refs.resolutionLoc, width, height)
          this.gl_refs.gl.uniform1f(this.gl_refs.borderRadiusLoc, this.borderRadius)
        }
      }
    } else {
      this.updateSizeFromDOM()
    }
  }

  setupAsNestedGlass() {
    if (this.parent && !this.isNestedGlass) {
      this.isNestedGlass = true
      if (this.webglInitialized) {
        this.initWebGL()
      }
    }
  }

  static measureText(text, fontSize) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`
    return ctx.measureText(text)
  }

  createTextElement() {
    this.textElement = document.createElement('div')
    this.textElement.className = 'glass-button-text'
    this.textElement.textContent = this.text
    this.textElement.style.fontSize = this.fontSize + 'px'
    this.element.appendChild(this.textElement)
  }

  setupClickHandler() {
    if (this.onClick && this.element) {
      this.element.addEventListener('click', e => {
        e.preventDefault()
        this.onClick(this.text)
      })
    }
  }

  initWebGL() {
    if (!Container.pageSnapshot || !this.gl) return

    if (this.parent && this.isNestedGlass) {
      this.initNestedGlass()
    } else {
      super.initWebGL()
    }
  }
}
