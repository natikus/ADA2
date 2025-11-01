class CommandBus {
  constructor() {
    this.handlers = new Map();
    this.executedCount = 0;
  }

  register(commandType, handler) {
    this.handlers.set(commandType, handler);
  }

  async execute(command) {
    const handler = this.handlers.get(command.type);
    if (!handler) {
      throw new Error(`No handler for command ${command.type}`);
    }
    this.executedCount++;
    return handler.handle(command);
  }
}

export default CommandBus;
