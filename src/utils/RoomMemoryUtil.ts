import { RoomPlannerUtils } from "empire/operations/Operations/roomPlanner/RoomPlannerUtils";
import { MapRoom } from "./MapRoom";

export class RoomMemoryUtil {
    public static  SCOUTING_INTERVALL = 5000;

    public static checkIfRoomNeedsScouting(roomName: string){
        if(!this.isRoomTypeSet(roomName)){
            this.setRoomType(roomName);
        }
        switch(Memory.rooms[roomName].roomType) {
            case 'NormalRoom':
                if(!this.isRoomUpToDate(roomName)){
                    return false;
                }
                if(!this.isBaseSet(roomName)){
                    return true;
                }
                if(!this.isResourcesSet(roomName)){
                    return false;
                }
            case 'HighwayRoom':
                if(!this.isRoomUpToDate(roomName)){
                    return false;
                }
            case 'Intersection':
                if(!this.isRoomUpToDate(roomName)){
                    return false;
                }
            case 'KeeperRoom':
                if(!this.isRoomUpToDate(roomName)){
                    return false;
                }
                if(!this.isResourcesSet(roomName)){
                    return false;
                }
        }
        return true;
    }

    public static setRoomMemory(room: Room): void {
            if(!this.isRoomTypeSet(room.name)){
                this.setRoomType(room.name);
            }
            switch(room.memory.roomType) {
                case 'NormalRoom':
                    if(!this.isRoomUpToDate(room.name)){
                        this.setLastSeen(room);
                    }
                    if(!this.isBaseSet(room.name)){
                        this.setBase(room);
                    }
                    if(!this.isResourcesSet(room.name)){
                        this.setRessources(room);
                    }
                    this.setOwner(room);
                case 'HighwayRoom':
                    if(!this.isRoomUpToDate(room.name)){
                        this.setLastSeen(room);
                    }
                case 'Intersection':
                    if(!this.isRoomUpToDate(room.name)){
                        this.setLastSeen(room);
                    }
                case 'KeeperRoom':
                    if(!this.isRoomUpToDate(room.name)){
                        this.setLastSeen(room);
                    }
                    if(!this.isResourcesSet(room.name)){
                        this.setRessources(room);
                    }
            }
    }

    public static isRoomUpToDate(roomName: string): boolean {
        const roomMemory = Memory.rooms[roomName];
        if(roomMemory != null){
            if(roomMemory.scouting != null){
                if(roomMemory.scouting.lastSeen != null){
                    if(roomMemory.scouting.lastSeen + this.SCOUTING_INTERVALL > Game.time){
                        return true;
                    }
                }
            }
        }
        return false;
    }

    public static isRoomTypeSet(roomName: string): boolean {
        if(Memory.rooms[roomName] != null){
            if(Memory.rooms[roomName].roomType != null){
                return true;
            }
        }
        return false;
    }

    public static isResourcesSet(roomName: string): boolean {
        if(this.isRoomTypeSet(roomName)){
            if(Memory.rooms[roomName].roomType === 'NormalRoom' || Memory.rooms[roomName].roomType === 'KeeperRoom' ){
                if(Memory.rooms[roomName].resources != null){
                    return true;
                }
            }
        }
        return false;
    }
    public static setOwner(room: Room): void {
        if(this.isRoomTypeSet(room.name)){
            if(Memory.rooms[room.name].roomType === 'NormalRoom'){
                if(room.controller != null){
                    room.memory.owner = room.controller.owner.username;
                }
            }
        }
    }

    public static setRessources(room: Room): void {
        if(this.isRoomTypeSet(room.name)){
            if(Memory.rooms[room.name].roomType === 'NormalRoom' || Memory.rooms[room.name].roomType === 'KeeperRoom' ){
                const sources = room.find(FIND_SOURCES);
                const minerals = room.find(FIND_MINERALS);
                room.memory.resources = {sources: sources.map( s => s.id), mineral: {type: minerals[0].mineralType, id: minerals[0].id }};
            }
        } 
    }

    public static setRoomType(roomName: string): void {
        const mapRoom = new MapRoom(roomName);
        Memory.rooms[roomName].roomType = mapRoom.getRoomType();
    }

    public static setLastSeen(room: Room): void {
        if(room != null){
            if(room.memory.scouting == null){
                room.memory.scouting = {};
            }
            room.memory.scouting.lastSeen = Game.time;
        }
    }

    public static setBase(room: Room): void {
        if(room.memory != null){
            if(room.memory.roomType === 'NormalRoom'){
                if(room.memory.base == null){
                    // INIT new 
                    const transform = RoomPlannerUtils.doTransform(room.name);
                    if(transform.length > 0){
                        const anchor = RoomPlannerUtils.getMostCenterPos(transform);
                        if(anchor != null){
                            room.memory.base = {bunker: true, anchor};
                        }
                    } else {
                        room.memory.base = {bunker: false};
                    }
                }
            }
        }
    }

    public static isBaseSet(roomName: string): boolean {
        const roomMemory = Memory.rooms[roomName];
        if(roomMemory != null){
            if(roomMemory.base != null){
                if(roomMemory.base.bunker != null){
                    if(roomMemory.base.bunker === true){
                        if(roomMemory.base.anchor != null){
                            return true;
                        }
                    } else if(roomMemory.base.bunker === false){
                        if(roomMemory.base.anchor == null){
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }
}