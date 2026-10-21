                                                 

/** Receives the text that is suitable for a character reaction. */
                                          
                                                                            
                                                  
                                                                         
                                                
 

/** Sends model reaction text to a host-owned presentation sink. */
export function createSparkNotifyReactionPlugin(sink                         )                    {
  return {
    name: 'spark-notify-reaction',
    prepare(turn) {
      return {
        onEvent(event) {
          if (event.type === 'model-output-text') {
            const text = typeof event.payload.text === 'string' ? event.payload.text : ''
            if (text)
              sink.onDelta(turn.event.data.id, text)
            return
          }

          if (event.type === 'result') {
            const reaction = typeof event.payload.reaction === 'string' ? event.payload.reaction : ''
            sink.onEnd(turn.event.data.id, reaction)
          }
        },
      }
    },
  }
}
