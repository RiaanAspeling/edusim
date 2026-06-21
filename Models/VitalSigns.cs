using System.Text.Json.Serialization;

namespace EduSim.Models;

public class VitalSigns
{
    public int HeartRate { get; set; } = 72;
    public int SpO2 { get; set; } = 98;
    public int SystolicBP { get; set; } = 120;
    public int DiastolicBP { get; set; } = 80;
    public int RespiratoryRate { get; set; } = 16;
    public double Temperature { get; set; } = 36.8;
    public int EtCO2 { get; set; } = 38;
    public int CVP { get; set; } = 5;

    // Intracranial pressure. Mean value (mmHg) plus the three pulse-wave peak
    // amplitudes (%) — P1 percussion, P2 tidal, P3 dicrotic — which encode
    // intracranial compliance and are adjusted independently of other vitals.
    [JsonPropertyName("icp")] public int ICP { get; set; } = 10;
    [JsonPropertyName("icpP1")] public int IcpP1 { get; set; } = 100;
    [JsonPropertyName("icpP2")] public int IcpP2 { get; set; } = 65;
    [JsonPropertyName("icpP3")] public int IcpP3 { get; set; } = 40;

    public string Rhythm { get; set; } = "nsr";

    // Per-channel display mode: "on" (waveform), "min" (number at bottom), "off"
    [JsonPropertyName("hrDisplay")] public string HrDisplay { get; set; } = "on";
    [JsonPropertyName("abpDisplay")] public string AbpDisplay { get; set; } = "on";
    [JsonPropertyName("cvpDisplay")] public string CvpDisplay { get; set; } = "on";
    [JsonPropertyName("icpDisplay")] public string IcpDisplay { get; set; } = "on";
    [JsonPropertyName("spo2Display")] public string Spo2Display { get; set; } = "on";
    [JsonPropertyName("rrDisplay")] public string RrDisplay { get; set; } = "on";

    // Irregularity: 0 = steady, higher = more natural beat/value variation (%)
    public int Irregularity { get; set; } = 0; // heart rate (R-R timing)
    [JsonPropertyName("spo2Irregularity")] public int SpO2Irregularity { get; set; } = 0;
    [JsonPropertyName("bpIrregularity")] public int BPIrregularity { get; set; } = 0;
    [JsonPropertyName("cvpIrregularity")] public int CVPIrregularity { get; set; } = 0;
    [JsonPropertyName("rrIrregularity")] public int RRIrregularity { get; set; } = 0;
    [JsonPropertyName("etco2Irregularity")] public int EtCO2Irregularity { get; set; } = 0;
    [JsonPropertyName("tempIrregularity")] public int TempIrregularity { get; set; } = 0;
    [JsonPropertyName("icpIrregularity")] public int IcpIrregularity { get; set; } = 0;
}
