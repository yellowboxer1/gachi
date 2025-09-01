// app/navigationState.js
import { EventEmitter } from 'events';

class NavigationState {
  _active = false;
  _emitter = new EventEmitter();

  enable() {
    if (!this._active) {
      this._active = true;
      this._emitter.emit('change', true);
    }
  }

  disable() {
    if (this._active) {
      this._active = false;
      this._emitter.emit('change', false);
    }
  }

  isActive() { return this._active; }

  subscribe(listener) {
    this._emitter.on('change', listener);
    return () => this._emitter.off('change', listener);
  }
}

const nav = new NavigationState();
export default nav;
