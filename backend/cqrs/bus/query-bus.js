class QueryBus {
  constructor() {
    this.handlers = new Map();
    this.executedCount = 0;
  }

  register(queryType, handler) {
    this.handlers.set(queryType, handler);
  }

  async execute(query) {
    const handler = this.handlers.get(query.type);
    if (!handler) {
      throw new Error(`No handler for query ${query.type}`);
    }
    this.executedCount++;
    return handler.handle(query);
  }
}

export default QueryBus;
