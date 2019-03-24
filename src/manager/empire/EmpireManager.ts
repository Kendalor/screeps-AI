import {EmpireConfig} from "manager/empire/EmpireConfig";
import {RoomManager} from "manager/empire/RoomManager";

export class EmpireManager  {
    public config: EmpireConfig;
    constructor(){
       this.config= new EmpireConfig();
    }
    
    public run(): void{
        console.log("Empire Manager doing Stuff ");
        const rooms: string[] = Object.keys(this.config.myRooms);
        for (const room in rooms){
            const roomManager = new RoomManager(rooms[room]);
            roomManager.run();
        }
    }
    /*
     Increments a counter if no creeps are alive and only one room is owned
    If counter reaches a threshold the  Memory of the Empire is reset. 
    */
    public detectSpawn(): boolean {
        const rooms: string[] = Object.keys(Game.rooms);
        const creeps: string [] = Object.keys(Game.creeps);
        if (rooms.length === 1 && creeps.length === 0) {
            const temp: Room = Game.rooms[rooms[0]];
            if (temp.controller) {
                if (temp.controller.level === 1) {
                    if(this.config.respawnSuspicion === 20) {
                 
                        const keys: string[] = Object.keys(Memory);
                        // Reset Creeps Memory
                        for (const name in Memory.creeps) {
                                delete Memory.creeps[name];
                        }
                        // Flag Memory
                        for (const name in Memory.flags) {
                                delete Memory.flags[name];
                        }

                        // Clear Flags
                        for (const name in Game.flags) {
                            Game.flags[name].remove();
                        }

                        // Spawn Memory
                        for (const name in Memory.spawns) {
                                delete Memory.spawns[name];
                        }
                        // Room Memory
                        for (const name in Memory.rooms) {
                                delete Memory.rooms[name];
                        }

                        // Resets Empire Memory
                        console.log("Resets Empire Memory");
                        delete Memory.empire;
                        return true;
                    } else {
                        this.config.respawnSuspicion += 1;
                        console.log("Respawn detected ! Counting " + this.config.respawnSuspicion +" of 100 for Reset of Memory !")
                        return false;
                    }
                }
            }
        }
        return false;
    }
}
