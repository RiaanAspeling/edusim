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
    public string Rhythm { get; set; } = "nsr";
}
