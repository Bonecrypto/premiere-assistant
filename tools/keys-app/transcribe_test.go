package main

import "testing"

// Формат — как пишет whisper-cli -oj (examples/cli/cli.cpp: offsets в мс, text), с -ml 1 -sow.
func TestParseWhisperJSON(t *testing.T) {
	b := []byte(`{"systeminfo":"x","result":{"language":"ru"},"transcription":[
	 {"timestamps":{"from":"00:00:00,000","to":"00:00:00,420"},"offsets":{"from":0,"to":420},"text":" Привет"},
	 {"timestamps":{"from":"00:00:00,420","to":"00:00:00,500"},"offsets":{"from":420,"to":500},"text":","},
	 {"offsets":{"from":500,"to":900},"text":" мир"},
	 {"offsets":{"from":900,"to":2000},"text":" [Музыка]"},
	 {"offsets":{"from":2000,"to":2300},"text":" \"кавычки\""}
	]}`)
	w, lang, err := parseWhisperJSON(b)
	if err != nil || lang != "ru" || len(w) != 3 || w[0].Text != "Привет," || w[0].End != 0.5 || w[1].Text != "мир" || w[2].Text != `"кавычки"` {
		t.Fatalf("%v %q %+v", err, lang, w)
	}
}
