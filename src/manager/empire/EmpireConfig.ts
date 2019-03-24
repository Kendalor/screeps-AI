

interface EmpireConfigMemory {
    respawnSuspicion: number;
    myRooms: {[roomName: string]: {}};
}

export class EmpireConfig {
    public myRooms: {[roomName: string]: {}};
    public respawnSuspicion: number;
    constructor() {
        if(Memory.empire === undefined) {
            Memory.empire = {};
        }
        if(Memory.empire.config === undefined) {
            Memory.empire.config = {};
        }
        if(Memory.empire.config.respawnSuspicion === undefined) {
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
}