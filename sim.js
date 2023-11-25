var _globalId = 0;
function nextId() {
  return _globalId++;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

class Simulation extends PIXI.Application {
  constructor({
    element,
  }) {
    super({
      backgroundAlpha: 0,
      resizeTo: element,
    });

    this.runSimulation = false;
    this.agents = [];
    //this.debug = true;

    element.innerHTML = '';
    let container = document.createElement('div');
    element.appendChild(container);

    let uiContainer = document.createElement('div');
    uiContainer.style.position = 'absolute';

    let runSimulationContainer = document.createElement('div');
    let runSimulationButton = document.createElement('button');
    runSimulationButton.innerText = 'Run';
    runSimulationContainer.appendChild(runSimulationButton);
    runSimulationButton.addEventListener('click', () => {
      this.runSimulation = !this.runSimulation;
      if (this.runSimulation) {
        runSimulationButton.innerText = 'Pause';
        this.ticker.start();
      } else {
        runSimulationButton.innerText = 'Run';
        this.ticker.stop();
      }
    });
    uiContainer.appendChild(runSimulationContainer);

    container.appendChild(uiContainer);
    container.appendChild(this.view);


    this.queues = []
    const queueOptions = [
      { name: 'default', color: 0xEDC951, minTS: 100, maxTS: 10000 },
      { name: 'slowQueue', color: 0xEB6841, minTS: 10000, maxTS: 50000 },
      //{ name: 'fastTrack', color: 0x0F942F, minTS: 100, maxTS: 500 },
    ];
    const taskWidth = 40;
    const queueY = 50;
    const queuePadding = this.screen.width / 4
    const queueSpacing = (this.screen.width - 2 * queuePadding) / (queueOptions.length - 1);
    queueOptions.forEach((opts, i) => {
      const queue = new QueueBucket(this, {
        name: opts.name,
        x: queuePadding + (i * queueSpacing) - i * (taskWidth + 10),
        y: queueY,
        size: taskWidth + 10,
        minTS: opts.minTS,
        maxTS: opts.maxTS,
        color: opts.color,
      });
      queue.fill(1);
      this.queues.push(queue);
    })

    this.thruPut = new ThruPutMeasure(this, {
      queues: this.queues,
      bottom: this.screen.height - this.screen.height * 0.1,
    });

    const numServers = 5;
    const pad = 10;
    const workerSize = taskWidth * 1.2;
    const serverSize = workerSize * 2 + pad * 4;
    const serverPadding = (this.screen.width - numServers * serverSize) / numServers + 1;
    this.servers = [];
    const serverY = this.screen.height - (workerSize + 2 * pad) - this.screen.height * 0.3
    for (let ns = 0; ns < numServers; ns++) {
      const s = new Server(this, {
        x: 0.5 * serverPadding + (ns * serverPadding) + ns * serverSize,
        y: serverY,
        workerSize: workerSize,
        serverSize: serverSize,
        padding: pad,
      });
      this.servers.push(s);
    }

    this.ticker.add((delta) => this.update(delta));
  }

  add(agent) {
    this.stage.addChild(agent);
    this.agents.push(agent);
  }

  update(delta) {
    if (!this.runSimulation) {
      this.ticker.stop();
    }
    if (this.debug) {
      console.log(`[simulator] checking for agents to remove`);
    }
    var numAgentsRemoved = 0;
    for (let i = this.agents.length - 1; i >= 0; i--) {
      if (this.debug) {
        console.log(`[simulator] checking index ${i} (${this.agents[i].id})`);
      }
      if (this.agents[i].destroyed) {
        var removed = this.agents.splice(i, 1);
        numAgentsRemoved++;
        if (this.debug) {
          console.log(`[simulator] removed ${removed[0].id}`);
        }
      }
    }
    if (this.debug) {
      console.log(`[simulator] removed ${numAgentsRemoved} agents`);
    }

    if (this.debug) {
      console.log(`[simulator] update(${delta})`);
    }
    for (let agents of this.agents) {
      agents.update(delta);
    }
    if (this.debug) {
      console.log(`[simulator] done updating`);
    }
  }
}

class Agent extends PIXI.Graphics {
  constructor(simulation) {
    super();
    this.simulation = simulation;
    this.id = nextId();
    this.debug = false;
    this.simulation.add(this);
    this.onDestroyHooks = [];
  }

  update(delta) {
    if (this.debug) {
      console.log(`[${this.id}] update(${delta})`);
    }
  }

  destroy() {
    if (this.debug) {
      console.log(`[${this.id}] destroy()`);
    }
    for (let f of this.onDestroyHooks) {
      f();
    }
    super.destroy();
  }

  onDestroy(f) {
    this.onDestroyHooks.push(f);
  }
}

class Worker extends Agent {
  constructor(simulation, { x, y, size, color, server }) {
    super(simulation);
    this.x = x;
    this.y = y;
    this.server = server;
    this.currentTask = null;
    this.size = size;

    this.beginFill(this.server.color);
    this.drawRoundedRect(0, 0, size, size, 10);
    this.endFill();
  }

  get centerX() {
    return this.x + this.size / 2;
  }

  get centerY() {
    return this.y + this.size / 2;
  }

  update(delta) {
    super.update(delta);
    if (this.currentTask == null) {
      if (this.debug) {
        console.log(`[${this.id}] no current task`);
      }
      this.currentTask = this.server.queue.dequeue();
      if (this.currentTask == null) {
        if (this.debug) {
          console.log(`[${this.id}] no task to do`);
        }
        return;
      }
      this.currentTask.worker = this;
      this.currentTask.inTransit = true;
      //this.currentTask.x = this.centerX;
      //this.currentTask.y = this.centerY;
      //this.currentTask.processing = true;
      if (this.debug) {
        console.log(`[${this.id}] got task ${this.currentTask.id}`);
      }
    }
    if (this.currentTask.duration - delta < 100) {
      if (this.debug) {
        console.log(`[${this.id}] task ${this.currentTask.id} done`);
      }
      this.currentTask.destroy();
      this.currentTask = null;
    }
  }
}

class Server extends Agent {
  constructor(simulation, { x, y, workerSize, serverSize, padding }) {
    super(simulation);
    this.x = x;
    this.y = y;
    this.color = 0x00A0B0;
    this.currentQueue = 0;

    const height = workerSize + 2 * padding;

    this.beginFill(this.color, 0.3);
    this.lineStyle(1, this.color, 0.5, 0);
    this.drawRect(0, 0, serverSize, height);
    this.endFill();

    const workerPositions = [
      { x: this.x + padding, y: this.y + padding, size: workerSize, server: this },
      { x: this.x + 3 * padding + workerSize, y: this.y + padding, size: workerSize, server: this },
    ];

    this.workers = workerPositions.map(opts => new Worker(simulation, opts));
  }

  get queue() {
    const queue = this.simulation.queues[this.currentQueue];
    this.currentQueue = (this.currentQueue + 1) % this.simulation.queues.length;
    return queue;
  }
}


class ThruPutMeasure extends Agent {
  constructor(simulation, { queues, bottom }) {
    super(simulation);
    this.queues = queues;
    this.bottom = bottom;
    this.ups = 0;

    this.beginFill(0x00A0B0, 0.3);
    this.lineStyle(1, 0x00A0B0, 0.5, 0);
    this.moveTo(20, bottom);
    this.lineTo(this.simulation.screen.width - 20, bottom);
    this.moveTo(20, bottom);
    this.lineTo(20, bottom - 100);
    this.endFill();

    this.text = new PIXI.Text(0, { fontFamily: 'Lora', fontSize: 14, fill: 0x4F372D, });
    this.text.x = this.simulation.screen.width - this.text.width - 50;
    this.text.y = bottom - 50 - this.text.height;
    this.addChild(this.text);
  }

  update(delta) {
    this.ups++;
    if (this.ups >= this.simulation.ticker.FPS) {
      let total = 0;
      for (let q of this.queues) {
        total += q.tasksPickedUp;
        q.tasksPickedUp = 0;
      }
      this.text.text = total;
      this.ups = 0;
    }
  }
}


class QueueBucket extends Agent {
  constructor(simulation, { name, x, y, size, tasksPerSecond, minTS, maxTS, color }) {
    super(simulation);
    this.name = name;
    this.x = x;
    this.y = y;
    this.taskWidth = size - 10;
    this._width = size + 10;
    this._height = size * 3;
    //this._color = 0x00AEDB;
    this._color = color;
    this.tasks = [];
    this._minTaskSize = minTS;
    this._maxTaskSize = maxTS;
    this.tasksPickedUp = 0;

    this.text = new PIXI.Text(this.name, { fontFamily: 'Lora', fontSize: 14, fill: 0x4F372D, });
    this.text.x = this._width / 2 - this.text.width / 2;
    this.text.y = - this.text.height - 10;
    this.addChild(this.text);

    this.beginFill(this._color, 0.3);
    this.lineStyle(1, this._color, 0.5, 0)
    this.drawRect(
      0,
      0,
      this._width,
      this._height,
    );
    this.endFill();
  }

  dequeue() {
    let nextTask = this.tasks.shift();
    if (nextTask != null) {
      this.tasksPickedUp++;
    }
    return nextTask;
  }

  fill(toFill) {
    const alreadyQueued = this.tasks.length;
    for (let i = 0; i < toFill - alreadyQueued; i++) {
      this.tasks.push(new Task(this.simulation, {
        x: this.x + this._width / 2,
        y: this.y + this._height - (i + alreadyQueued) * (this.taskWidth + 1),
        duration: randomInt(this._minTaskSize, this._maxTaskSize),
        size: this.taskWidth,
        color: this._color,
      }));
    }
  }

  update(delta) {
    super.update(delta);
    if (this.tasks.length == 10) {
      return
    }
    if (this.name == 'slowQueue') {
      if (Math.random() < 0.01) {
        this.fill(this.tasks.length + 1);
      }
    } else {
      this.fill(10);
    }

    if (this.tasks.length == 0) {
      return;
    }

    let currentOffset = -this.tasks[0].height / 2;
    this.tasks.forEach(task => {
      if (task.height + currentOffset < this._height) {
        task.isVisibile = true;
        currentOffset += task.height / 2;
        task.y = this.y + this._height - currentOffset;
        currentOffset += task.height / 2;
      }
    });
  }
}

const MAX_DURATION = 10000;

class Task extends Agent {
  constructor(simulation, { x, y, duration, size, color }) {
    super(simulation);
    this.x = x;
    this.y = y;
    this.initSize = size;
    this.duration = duration;
    this._color = color;
    this.isVisibile = false;
    this.processing = false;
    this.inTransit = false;
    this.speed = 10;
  }

  get height() {
    const elapsedHeight = this.initSize * Math.min(this.duration, MAX_DURATION) / MAX_DURATION;
    return Math.max(elapsedHeight, 5);
  }

  get width() {
    return this.initSize;
  }

  get radius() {
    return this.height / 2;
  }

  draw() {
    if (this.destroyed) {
      return;
    }
    this.clear();
    if (!this.isVisibile) {
      return;
    }
    this.beginFill(this._color);
    this.drawCircle(0, 0, this.radius);
    this.endFill();
  }

  update(delta) {
    super.update(delta);
    if (this.processing) {
      this.duration = Math.max(this.duration - delta * 100, 100);
    }
    if (this.inTransit) {
      const dx = this.worker.centerX - this.x;
      const dy = this.worker.centerY - this.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < this.speed * delta) {
        this.x = this.worker.centerX;
        this.y = this.worker.centerY;
        this.processing = true;
        this.inTransit = false;
      } else {
        const rotation = Math.atan2(this.worker.centerY - this.y, this.worker.centerX - this.x);
        this.x += Math.cos(rotation) * this.speed * delta;
        this.y += Math.sin(rotation) * this.speed * delta;
      }
    }
    if (this.isVisibile) {
      this.draw();
    }
  }
}

document.addEventListener("DOMContentLoaded", function() {
  let sim = new Simulation({
    element: document.getElementById("sim"),
  });


  //// Initialize PIXI Application
  //const app = new PIXI.Application({ width: 800, height: 600 });
  //document.getElementById('sim').appendChild(app.view);

  //// Create a red square
  //const square = new PIXI.Graphics();
  //square.beginFill(0xFF0000);
  //square.drawRect(0, 0, 100, 100);
  //square.endFill();
  //square.x = 50;
  //square.y = 50;

  //// Add the square to the stage
  //app.stage.addChild(square);

  //// Animation loop
  //app.ticker.add(() => {
  //// Rotate the square
  //square.rotation += 0.01;
  //});
});
