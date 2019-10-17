export interface SpawnEntryMemory {
    memory: any;
    rebuild: boolean;
    room: string;
    pause: number;
    body?: BodyPartConstant[];
    priority: number;
}

export class SpawnEntry implements SpawnEntryMemory{
    public memory: any;
    public rebuild: boolean;
    public room: string;
    public pause: number;
    public body?: BodyPartConstant[];
    public priority: number;
    
    constructor(data: SpawnEntryMemory){
        this.memory = data.memory;
        this.rebuild = data.rebuild;
        this.room = data.room;
        this.pause = data.pause;
        this.priority = data.priority;
        this.body = data.body;
    }

    
    public equals(entry: SpawnEntry): boolean {
        if(entry.memory === this.memory 
            && entry.rebuild === this.rebuild
            && entry.room === this.room
            && entry.priority === this.priority
            && entry.body === this.body){
                return true;
            } else {
                return false;
            }
    }

    public toMemory(): SpawnEntryMemory {
        return {memory: this.memory, rebuild: this.rebuild,room: this.room, pause: this.pause, priority: this.priority, body: this.body};
    }
}