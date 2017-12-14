export class RoomData {
  public name: string;

  public run(room: Room) {
    if (!room) {return; }
    let room = Game.rooms[this.name];
    room.me
  }

  public readDataFromMemory(){

  }

  public writeDataToMemory(){
  //TODO
  }
  public calculateRessourceSlots(){
  //TODO
  }
  public searchSourceContainer(){
  //TODO
  }
  public buildData(){
    //TODO
  }
}
