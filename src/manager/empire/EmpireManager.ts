import {EmpireConfig} from "manager/empire/EmpireConfig";
import { Manager } from "manager/Manager";
import { RoomManager } from "manager/room/RoomManager";

export class EmpireManager extends Manager<EmpireConfig> {

    constructor(){
        super(EmpireConfig);
    }
    
    public run(): void{
        const rooms: string[] = Object.keys(this.config.myRooms);
        for (const room in rooms){
            console.log("Empire Manager doing Stuff ");
            const roomManager = new RoomManager(this, rooms[room]);
            roomManager.run();
            roomManager.destroy();
        }
    }

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


    private validateConfig(): void {
        console.log("Validate Config");
        for(const i in Object.keys(this.config.myRooms)) {
            console.log("Validate: "+ i);
           /* const room: Room = Game.rooms[this.config.myRooms[i]];
            if(room.controller === undefined) {
                delete this.config.myRooms[i];
            } else if (!room.controller.my) {
               delete this.config.myRooms[i];
            } */
        }
    }
}
