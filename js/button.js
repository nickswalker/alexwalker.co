class Button extends Container {
  constructor(options = {}) {
    super(options);

    this.options = {
      text: options.text || 'Button',
      size: options.size || 24,
      type: options.type || 'rounded',
      tintOpacity: options.tintOpacity || 0.3,
      warp: options.warp || false,
      onClick: options.onClick || null
    };

    this.element.classList.add('glass-button');

    if (this.options.type === 'circle') {
      this.element.classList.add('glass-button-circle');
    }

    const textEl = document.createElement('div');
    textEl.className = 'glass-button-text';
    textEl.textContent = this.options.text;
    textEl.style.fontSize = this.options.size + 'px';

    this.element.appendChild(textEl);

    if (this.options.onClick) {
      this.element.addEventListener('click', () => {
        this.options.onClick(this.options.text);
      });
    }

    // Apply tint
    this.element.style.background = `rgba(255,255,255,${this.options.tintOpacity})`;
  }
}

window.Button = Button;
