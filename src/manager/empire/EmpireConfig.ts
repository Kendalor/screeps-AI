

interface EmpireConfigMemory {
    respawnSuspicion: number;
    myRooms: {[roomName: string]: {}};
}

export class EmpireConfig {
    public myRooms: {[roomName: string]: {}};
    public respawnSuspicion: number;
    constructor() {
        if(Memory.empire === undefined) {
            console.log("Creating new empire Memory");
            Memory.empire = {};
        }
        if(Memory.empire.config === undefined) {
            console.log("Creating new empire Memory.config");
            Memory.empire.config = {};
        }
        if(Memory.empire.config.respawnSuspicion === undefined) {
            console.log("Creating new empire Memory.config.respawnSuspicion");
            this.respawnSuspicion = 0;
            Memory.empire.config.respawnSuspicion=this.respawnSuspicion;
        } else {
            this.respawnSuspicion = Memory.empire.config.respawnSuspicion;
        }

        if (Memory.empire.myRooms === undefined) {
            this.myRooms={};
            const spawns: string[] = Object.keys(Game.spawns);
            if(spawns.length === 1){
                this.myRooms[Game.spawns[spawns[0]].room.name] = {};
    
            }
            if (spawns.length > 1 ) {
                for( const i in spawns ) {
                    this.myRooms[Game.spawns[spawns[i]].room.name] = {};
                }
            }
            Memory.empire.config.myRooms = this.myRooms;
        } else {
            this.myRooms = Memory.empire.config.myRooms;
        }
    }

    public save(): void {
        Memory.empire.config.myRooms = this.myRooms;
        Memory.empire.config.respawnSuspicion = this.respawnSuspicion;
        console.log("Empire Config saved");
    }
}