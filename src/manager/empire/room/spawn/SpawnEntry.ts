export interface SpawnEntryMemory {
    body: BodyPartConstant[];
    memory: CreepMemory;
    name: string;
    rebuild: true;
    pause: number;
    priority: number;
}
export class SpawnEntry implements SpawnEntryMemory{
    public body: BodyPartConstant[];
    public memory: CreepMemory;
    public name: string;
    public rebuild: true;
    public pause: number;
    public priority: number;
    
    constructor(data: SpawnEntryMemory){
        this.body = data.body;
        this.memory = data.memory;
        this.name = data.name;
        this.rebuild = data.rebuild;
        this.pause = data.pause;
        this.priority = data.priority;
    }

    public getCost(): number {
        let out: number = 0;
        for(const i of this.body){
            out = BODYPART_COST[i] + out;
        }
        return out;
    }
}