export class BaseEvent {
  constructor(type, payload) {
    this.type = type;
    this.payload = payload;
    this.timestamp = new Date().toISOString();
  }
}

export class LibroCreadoEvent extends BaseEvent {
  constructor(payload) { super('LIBRO_CREADO', payload); }
}

export class PrestamoCreadoEvent extends BaseEvent {
  constructor(payload) { super('PRESTAMO_CREADO', payload); }
}

export class PrestamoDevueltoEvent extends BaseEvent {
  constructor(payload) { super('PRESTAMO_DEVUELTO', payload); }
}

class EventPublisher {
  constructor() {
    this.subscribers = new Map();
    this.publishedCount = 0;
  }

  subscribe(eventType, handler) {
    if (!this.subscribers.has(eventType)) this.subscribers.set(eventType, []);
    this.subscribers.get(eventType).push(handler);
  }

  async publish(event) {
    this.publishedCount++;
    const handlers = this.subscribers.get(event.type) || [];
    for (const h of handlers) {
      try { await h.handle(event); } catch (e) { console.error(e); }
    }
  }
}

export default EventPublisher;
