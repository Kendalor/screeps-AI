import { RoomPlannerUtils } from "empire/operations/Operations/roomPlanner/RoomPlannerUtils";
import { MapRoom } from "./MapRoom";

export class RoomMemoryUtil {
    public static  SCOUTING_INTERVALL = 50000;

    public static checkIfRoomNeedsScouting(roomName: string){
        if(!this.isRoomTypeSet(roomName)){
            this.setRoomType(roomName);
        }
        switch(Memory.rooms[roomName].roomType) {
            case 'NormalRoom':
                if(!this.isRoomUpToDate(roomName)){
                    return true;
                }
                if(!this.isBaseSet(roomName)){
                    return true;
                }
                if(!this.isResourcesSet(roomName)){
                    return true;
                }
                break;
            case 'HighwayRoom':
                if(!this.isRoomUpToDate(roomName)){
                    return true;
                }
                break;
            case 'Intersection':
                if(!this.isRoomUpToDate(roomName)){
                    console.log("Room: " + roomName + " is not upToDate");
                    return true;
                }
                break;
            case 'KeeperRoom':
                if(!this.isRoomUpToDate(roomName)){
                    return true;
                }
                if(!this.isResourcesSet(roomName)){
                    return true;
                }
                break;
        }
        return false;
    }

    public static isRoomFriendly(roomName: string): boolean {
        const mem = Memory.rooms[roomName];
        if(mem != null){
            if(mem.owner != null){
                if(mem.owner !== 'Kendalor'){
                    return false;
                }
            }
        }
        return true;
    }

    public static getRoomsInMemory(): string[] {
        return Object.keys(Memory.rooms);
    }

    public static routeCallBack(roomName: string): number {
        const r = new MapRoom(roomName);
        if(r.isHighway() || r.isIntersection()){
            return 1;
        } else if( !RoomMemoryUtil.isRoomFriendly(roomName)){
            return 100;
        } else {
            return 2;
        }
    }
    public static isRoomColonizeAble(roomName: string): boolean {
        const mem = Memory.rooms[roomName];
        if(mem != null){
            if(mem.roomType === 'NormalRoom'){
                if(mem.owner === undefined){
                    return true;
                }
            }
        }
        return false;
    }

    public static getDistance(from: string, to: string){
        const route =Game.map.findRoute(from,to, {
            routeCallback: this.routeCallBack
        });
        if(route !== -2){
            return route.length;
        } else {
            return 254;
        }
    }

    public static findPath(from: RoomPosition, to: RoomPosition): RoomPosition[] | undefined{
        const allowedRooms = {[from.roomName]: true};
        const route =Game.map.findRoute(from.roomName,to.roomName, {
            routeCallback: this.routeCallBack
        });
        if(route !== -2){
            for(const r of route){
                allowedRooms[r.room] = true;
            }
            const path = PathFinder.search(from,to, {
                roomCallback(roomName: string){
                    if(allowedRooms[roomName] === true){
                        return true;
                    }else {
                        return false;
                    }
                }
            });
            if(path != null){
                return path.path;
            }
        }
        return undefined;
    }

    public static setRoomMemory(room: Room): void {
            if(!this.isRoomTypeSet(room.name)){
                this.setRoomType(room.name);
            }
            console.log("Setting RoomMemory for: " + room.name);
            switch(room.memory.roomType) {
                case 'NormalRoom':
                    console.log("Case NormalRoom");
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
                    break;
                case 'HighwayRoom':
                    console.log("Case HighwayRoom");
                    if(!this.isRoomUpToDate(room.name)){
                        this.setLastSeen(room);
                    }
                    break;
                case 'Intersection':
                    console.log("Case Intersection");
                    console.log("Checking Update: ")
                    if(!this.isRoomUpToDate(room.name)){
                        console.log("Room is not UpToDate");
                        this.setLastSeen(room);
                    }
                    break;
                case 'KeeperRoom':
                    console.log("Case KeeperRoom");
                    if(!this.isRoomUpToDate(room.name)){
                        this.setLastSeen(room);
                    }
                    if(!this.isResourcesSet(room.name)){
                        this.setRessources(room);
                    }
                    break;
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
                    if(room.controller.owner != null){
                        room.memory.owner = room.controller.owner.username;
                    }
                }
            }
        }
    }

    public static isRoomNeutral(roomName: string){
        if(Memory.rooms[roomName].roomType === 'NormalRoom'){
            if(Memory.rooms[roomName].owner != null){
                if(Memory.rooms[roomName].owner !== 'Kendalor'){
                    return false;
                }
            }
        }
        return true;
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
        if(Memory.rooms[roomName] == null){
            Memory.rooms[roomName] = {} as RoomMemory;
        }
        Memory.rooms[roomName].roomType = mapRoom.getRoomType();
    }

    public static setLastSeen(room: Room): void {
        console.log("SetLastSeen");
        if(room != null){
            console.log("Room != null");
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