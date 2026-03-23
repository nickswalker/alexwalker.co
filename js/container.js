class Container {
  constructor(options = {}) {
    this.options = options;
    this.element = document.createElement('div');
    this.element.className = 'glass-container';

    this.gl_refs = {
      gl: true // placeholder so your existing code doesn't break
    };

    Container.instances.push(this);
  }

  addChild(child) {
    this.element.appendChild(child.element);
  }

  removeChild(child) {
    this.element.removeChild(child.element);
  }

  updateSizeFromDOM() {}

  render() {}
}

Container.instances = [];

window.Container = Container;
