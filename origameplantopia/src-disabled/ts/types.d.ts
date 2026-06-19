interface OrigamePlantopiaPlayer extends Player {
    energy: number; // any information you add on each result['players']
}

interface OrigamePlantopiaGamedatas extends Gamedatas<OrigamePlantopiaPlayer> {
    // Add here variables you set up in getAllDatas
}
   
/*
 * Describe here the types for your state args
 */
interface PlayerTurnArgs {
    playableCardsIds: number[];
}
   
/*
 * Describe here the types for your notif args
 */