
export interface SpawnEntryMemory {
    memory: any;
    rebuild: boolean;
    room: string;
    pause: number;
    body?: BodyPartConstant[];
    priority: number;
    toPos?: {x: number, y:number};
}

export class SpawnEntry implements SpawnEntryMemory{
    public memory: any;
    public rebuild: boolean;
    public room: string;
    public pause: number;
    public body?: BodyPartConstant[];
    public priority: number;
    public toPos?: RoomPosition;
    public op: string;
    
    constructor(data: SpawnEntryMemory){
        this.memory = data.memory;
        this.rebuild = data.rebuild;
        this.room = data.room;
        this.pause = data.pause;
        this.priority = data.priority;
        this.body = data.body;
        this.op = data.memory.op;
        if(data.toPos != null){
            this.toPos = new RoomPosition(data.toPos.x, data.toPos.y, data.room);
        }
    }

    
    public equals(entry: SpawnEntry): boolean {
        if(entry.memory === this.memory 
            && entry.rebuild === this.rebuild
            && entry.room === this.room
            && entry.priority === this.priority
            && entry.body === this.body
            && entry.op === this.op){
                return true;
            } else {
                return false;
            }
    }

    public toMemory(): SpawnEntryMemory {
        return {memory: this.memory, rebuild: this.rebuild,room: this.room, pause: this.pause, priority: this.priority, body: this.body, toPos: this.toPos};
    }
}