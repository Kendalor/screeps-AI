export interface SpawnEntryMemory {
    memory: CreepMemory;
    name: string;
    rebuild: true;
    pause: number;
    priority: number;
}

export class SpawnEntry implements SpawnEntryMemory{
    public memory: CreepMemory;
    public name: string;
    public rebuild: true;
    public pause: number;
    public priority: number;
    
    constructor(data: SpawnEntryMemory){
        this.memory = data.memory;
        this.name = data.name;
        this.rebuild = data.rebuild;
        this.pause = data.pause;
        this.priority = data.priority;
    }



    public toMemory(): SpawnEntryMemory {
        return {memory: this.memory, name: this.name, rebuild: this.rebuild, pause: this.pause, priority: this.priority};
    }
}